import OSC from "osc-js";

/**
 * Coerce a JS value to the correct JS type for osc-js's inference.
 * osc-js picks OSC type tag from JS type: integer number -> 'i', decimal -> 'f', string -> 's', bool -> 'T'/'F'.
 * If `osctype` is given, we force the conversion; otherwise we parse-through:
 *  - string "6" + osctype "int" => 6
 *  - string "0.5" + osctype "float" => 0.5
 *  - number 6 with no osctype => 6 (int)
 *  - number 0.5 with no osctype => 0.5 (float)
 *
 * Critical for X32: `/config/color`, `/config/icon`, `/config/chlink`, scene recall, etc. all require int type.
 * LLMs often pass ints as JSON strings when schemas are loose — this lets callers force the right tag.
 */
export function coerceOscArg(v: any, osctype?: "int" | "float" | "string" | "bool"): any {
    if (osctype === "int") {
        const n = typeof v === "number" ? Math.trunc(v) : parseInt(String(v), 10);
        if (Number.isNaN(n)) throw new Error(`Cannot coerce ${JSON.stringify(v)} to int`);
        // ensure integer for osc-js isInt() check (n % 1 === 0)
        return n;
    }
    if (osctype === "float") {
        const n = typeof v === "number" ? v : parseFloat(String(v));
        if (Number.isNaN(n)) throw new Error(`Cannot coerce ${JSON.stringify(v)} to float`);
        // osc-js isFloat requires n % 1 !== 0; force a fractional component if whole
        return Number.isInteger(n) ? n + 0.0000001 : n;
    }
    if (osctype === "string") return String(v);
    if (osctype === "bool") {
        if (typeof v === "boolean") return v;
        const s = String(v).toLowerCase();
        return s === "true" || s === "1" || s === "on";
    }
    // No explicit type — pass through; osc-js will infer from JS type.
    return v;
}

// ========== Routing source encoders/decoders ==========
// Confirmed against live X32 (firmware 2.07+) on 2026-04-14.
// Probe data: slot 27 source 129 => X32-Edit label "Card 01" => 129-160 = Card 1-32.

/**
 * Decode a User In slot source code to a human label.
 * Domain: /config/userrout/in/NN (0..168).
 */
export function decodeUserInSource(n: number): string {
    if (n === 0) return "OFF";
    if (n >= 1 && n <= 32) return `Local ${n}`;
    if (n >= 33 && n <= 80) return `AES50A ${n - 32}`;
    if (n >= 81 && n <= 128) return `AES50B ${n - 80}`;
    if (n >= 129 && n <= 160) return `Card ${n - 128}`;
    if (n >= 161 && n <= 168) return `AUX In ${n - 160}`;
    return `UNKNOWN(${n})`;
}

/**
 * Encode a human label back to a User In source code.
 * Accepts labels like "Card 1", "Local 27", "AES50A 5", "AES50B 12", "AUX In 3", "OFF".
 * Case-insensitive, tolerant of extra spaces.
 */
export function encodeUserInSource(label: string | number): number {
    if (typeof label === "number") return label;
    const s = label.trim().toUpperCase().replace(/\s+/g, " ");
    if (s === "OFF" || s === "0") return 0;
    const m = s.match(/^(LOCAL|AES50A|AES50B|CARD|AUX IN|AUX)\s*(\d+)$/);
    if (!m) throw new Error(`Cannot parse User In source label: "${label}". Expected e.g. "Card 1", "Local 27", "AES50A 5", "OFF".`);
    const kind = m[1];
    const n = parseInt(m[2], 10);
    if (kind === "LOCAL") {
        if (n < 1 || n > 32) throw new Error(`Local out of range: ${n}`);
        return n;
    }
    if (kind === "AES50A") {
        if (n < 1 || n > 48) throw new Error(`AES50A out of range: ${n}`);
        return 32 + n;
    }
    if (kind === "AES50B") {
        if (n < 1 || n > 48) throw new Error(`AES50B out of range: ${n}`);
        return 80 + n;
    }
    if (kind === "CARD") {
        if (n < 1 || n > 32) throw new Error(`Card out of range: ${n}`);
        return 128 + n;
    }
    // AUX IN / AUX
    if (n < 1 || n > 8) throw new Error(`AUX In out of range: ${n}`);
    return 160 + n;
}

/**
 * Decode a block-level routing selector (the 8-channel block value).
 * Used by /config/routing/IN/*, /config/routing/AES50A/*, /config/routing/AES50B/*, /config/routing/CARD/*.
 * Each block represents 8 channels; the value selects which source group feeds that block.
 * Confirmed on live hardware: IN 1-8=20..IN 25-32=23 => User In 1-8..25-32.
 */
export function decodeBlockInSource(n: number): string {
    if (n >= 0 && n <= 3) return `Local ${n * 8 + 1}-${n * 8 + 8}`;
    if (n >= 4 && n <= 9) return `AES50A ${(n - 4) * 8 + 1}-${(n - 4) * 8 + 8}`;
    if (n >= 10 && n <= 15) return `AES50B ${(n - 10) * 8 + 1}-${(n - 10) * 8 + 8}`;
    if (n >= 16 && n <= 19) return `Card ${(n - 16) * 8 + 1}-${(n - 16) * 8 + 8}`;
    if (n >= 20 && n <= 23) return `User In ${(n - 20) * 8 + 1}-${(n - 20) * 8 + 8}`;
    if (n === 24) return "AUX In 1-6 / TB / USB";
    return `UNKNOWN(${n})`;
}

/**
 * Decode a User Out slot source code (output tap selection).
 * Note: this enum is less fully verified than User In. Identity mapping (slot 1-32 = source 1-32)
 * was observed on the live mixer, which matches the pmaillot spec for Out 1-32 taps,
 * but ranges above 32 are best-effort and should be verified before relied upon.
 */
export function decodeUserOutSource(n: number): string {
    if (n === 0) return "OFF";
    if (n >= 1 && n <= 16) return `Out ${n} (Local)`;
    if (n >= 17 && n <= 32) return `Out ${n}`;
    if (n >= 33 && n <= 48) return `P16 ${n - 32}`;
    if (n >= 49 && n <= 50) return n === 49 ? "Monitor L" : "Monitor R";
    return `UNKNOWN(${n}) — see X32 OSC spec, not fully verified`;
}

export type OSCProtocol = "OSCX32M32" | "OSCXR";

export function parseOscCountEnv(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (!raw) return defaultValue;

    const parsed = parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        console.error(`Invalid ${name}="${raw}". Using default ${defaultValue}.`);
        return defaultValue;
    }
    return parsed;
}

export class OSCClient {
    private osc: any;
    private host: string;
    private port: number;
    private responseCallbacks: Map<string, (value: any) => void> = new Map();
    private isConnected: boolean = false;
    private mixerOnline: boolean = true;
    private lastHealthCheckAt: Date | null = null;
    private lastHealthError: string | null = null;
    private mixerHealthCheckPromise: Promise<void> | null = null;
    private protocol: OSCProtocol;
    private debugOsc: boolean;
    private channelCount: number;
    private busCount: number;
    private fxCount: number;
    private dcaCount: number;
    private oscCommandLog: string[] = [];

    constructor(
        host: string,
        port: number,
        protocol: OSCProtocol = "OSCX32M32",
        options: { channelCount?: number; busCount?: number; fxCount?: number; dcaCount?: number } = {}
    ) {
        this.host = host;
        this.port = port;
        this.protocol = protocol;
        this.debugOsc = process.env.DEBUG === "1" || process.env.DEBUG?.toLowerCase() === "true";
        this.channelCount = options.channelCount ?? parseOscCountEnv("OSC_CHANNEL_COUNT", 32);
        this.busCount = options.busCount ?? parseOscCountEnv("OSC_BUS_COUNT", 16);
        this.fxCount = options.fxCount ?? parseOscCountEnv("OSC_FX_COUNT", 8);
        this.dcaCount = options.dcaCount ?? parseOscCountEnv("OSC_DCA_COUNT", 8);

        // Create OSC instance with UDP plugin
        const plugin = new (OSC as any).DatagramPlugin({
            open: {
                host: "0.0.0.0",
                port: 0,
            },
            send: {
                host: this.host,
                port: this.port,
            },
        });

        this.osc = new (OSC as any)({
            plugin: plugin,
        });

        // Handle incoming OSC messages
        this.osc.on("*", (message: any) => {
            const address = message.address;
            const callback = this.responseCallbacks.get(address);

            if (callback && message.args && message.args.length > 0) {
                callback(message.args);
                this.responseCallbacks.delete(address);
            }
        });

        this.osc.on("error", (err: Error) => {
            console.error("OSC Error:", err);
        });
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // Open OSC connection (listening on any available port, all interfaces)
                this.osc.open({
                    host: "0.0.0.0",
                    port: 0,
                });

                this.isConnected = true;
                console.error("OSC UDP Port ready");

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    private isWrite(args?: any[]): boolean {
        return args !== undefined;
    }

    private async sendCommand(address: string, args?: any[], options?: { allowOfflineWrite?: boolean }): Promise<void> {
        if (!this.isConnected) {
            console.error("OSC not connected");
            return;
        }
        const trace = this.formatOscCommand(address, args);
        const isWrite = this.isWrite(args);
        if (isWrite) {
            this.recordOscCommand(trace);
        }
        if (isWrite && !options?.allowOfflineWrite) {
            try {
                await this.ensureMixerOnline();
            } catch (error) {
                this.recordOscCommand(`${trace} blocked: Le mixeur est deconnecté`);
                throw error;
            }
        }

        const message = new (OSC as any).Message(address, ...(args || []));
        if (!isWrite) {
            this.recordOscCommand(trace);
        }
        this.osc.send(message);
    }

    private valuesMatch(expected: any, actual: any, tolerance = 0.002): boolean {
        if (typeof expected === "number" && typeof actual === "number") {
            return Math.abs(expected - actual) <= tolerance;
        }
        return expected === actual;
    }

    private formatOscValue(value: any): string {
        return typeof value === "number" ? value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : JSON.stringify(value);
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async writeAndVerify(address: string, args: any[], options?: { tolerance?: number; label?: string; attempts?: number; retryDelayMs?: number }): Promise<any> {
        if (args.length !== 1) {
            throw new Error(`Transactional OSC write requires exactly one argument for ${address}`);
        }

        const expected = args[0];
        const attempts = Math.max(1, options?.attempts ?? 5);
        const retryDelayMs = options?.retryDelayMs ?? 60;
        await this.sendCommand(address, args, { allowOfflineWrite: true });

        let actual: any = undefined;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            if (attempt > 1) {
                await this.sleep(retryDelayMs);
            }

            try {
                actual = await this.sendAndReceive(address);
                this.mixerOnline = true;
                this.lastHealthError = null;
            } catch (error) {
                this.mixerOnline = false;
                this.lastHealthError = error instanceof Error ? error.message : String(error);
                throw new Error(`Le mixeur est deconnecté: impossible de confirmer l'ecriture OSC ${address}`);
            }

            if (this.valuesMatch(expected, actual, options?.tolerance)) {
                this.recordOscCommand(`[OSC VERIFY] ${this.protocol} ${this.host}:${this.port} ${address} confirmed ${this.formatOscValue(actual)}${attempt > 1 ? ` after ${attempt} reads` : ""}`);
                return actual;
            }
        }

        const target = options?.label || address;
        throw new Error(
            `La commande OSC a mal ete executee pour ${target}: valeur envoyee ${this.formatOscValue(expected)}, valeur relue ${this.formatOscValue(actual)} apres ${attempts} tentative(s)`
        );
    }

    private async ensureMixerOnline(): Promise<void> {
        if (this.mixerHealthCheckPromise) {
            return this.mixerHealthCheckPromise;
        }

        this.lastHealthCheckAt = new Date();
        this.mixerHealthCheckPromise = (async () => {
            try {
                await this.sendAndReceiveArgs("/xinfo");
                this.mixerOnline = true;
                this.lastHealthError = null;
            } catch (error) {
                this.mixerOnline = false;
                this.lastHealthError = error instanceof Error ? error.message : String(error);
                throw new Error("Le mixeur est deconnecté");
            } finally {
                this.mixerHealthCheckPromise = null;
            }
        })();

        return this.mixerHealthCheckPromise;
    }

    private formatOscCommand(address: string, args?: any[]): string {
        const mode = this.isWrite(args) ? "WRITE" : "READ";
        const payload = this.isWrite(args) ? ` args=${JSON.stringify(args)}` : "";
        return `[OSC ${mode}] ${this.protocol} ${this.host}:${this.port} ${address}${payload}`;
    }

    private logOscCommand(trace: string): void {
        if (!this.debugOsc) return;

        console.error(trace);
    }

    private recordOscCommand(trace: string): void {
        this.logOscCommand(trace);
        this.oscCommandLog.push(trace);
    }

    clearOscCommandLog(): void {
        this.oscCommandLog = [];
    }

    drainOscCommandLog(): string[] {
        const commands = this.oscCommandLog;
        this.oscCommandLog = [];
        return commands;
    }

    /*
    sendRaw : sendCommand est privé dans le dépôt actuel. Le client OSC existe déjà et envoie les commandes UDP vers la console.
    */
    async sendRaw(address: string, args?: any[], options?: { allowOfflineWrite?: boolean }): Promise<void> {
        await this.sendCommand(address, args, options);
    }

    async readRaw(address: string, args?: any[]): Promise<any> {
        return await this.sendAndReceive(address, args);
    }

    async assertMixerOnline(): Promise<void> {
        await this.ensureMixerOnline();
    }

    private async sendAndReceive(address: string, args?: any[]): Promise<any> {
        return new Promise((resolve, reject) => {
            this.responseCallbacks.set(address, (args: any[]) => resolve(args[0]));
            this.sendCommand(address, args).catch((error) => {
                this.responseCallbacks.delete(address);
                reject(error);
            });

            // Timeout after 1 second
            setTimeout(() => {
                if (this.responseCallbacks.has(address)) {
                    this.responseCallbacks.delete(address);
                    reject(new Error(`Timeout waiting for response from ${address}`));
                }
            }, 1000);
        });
    }

    private async sendAndReceiveArgs(address: string, args?: any[]): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.responseCallbacks.set(address, resolve);
            this.sendCommand(address, args).catch((error) => {
                this.responseCallbacks.delete(address);
                reject(error);
            });

            setTimeout(() => {
                if (this.responseCallbacks.has(address)) {
                    this.responseCallbacks.delete(address);
                    reject(new Error(`Timeout waiting for response from ${address}`));
                }
            }, 1000);
        });
    }



    private getMainStereoPath(): string {
        return this.protocol === "OSCXR" ? "/lr" : "/main/st";
    }

    private getChannelPath(channel: number): string {
        return `/ch/${channel.toString().padStart(2, "0")}`;
    }

    private getBusPath(bus: number): string {
        return this.protocol === "OSCXR"
            ? `/bus/${bus}`
            : `/bus/${bus.toString().padStart(2, "0")}`;
    }

    private getAuxPath(aux: number): string {
        if (this.protocol === "OSCXR") {
            if (aux !== 1) {
                this.unsupportedForXR("Indexed aux inputs are not mapped; OSCXR exposes the aux return as /rtn/aux.");
            }
            return "/rtn/aux";
        }
        return `/auxin/${aux.toString().padStart(2, "0")}`;
    }

    private getFxReturnPath(effect: number): string {
        return this.protocol === "OSCXR"
            ? `/rtn/${effect}`
            : `/fxrtn/${effect.toString().padStart(2, "0")}`;
    }

    private getBusSendSegment(bus: number): string {
        return bus.toString().padStart(2, "0");
    }

    private getAuxBusPath(aux: number, bus: number): string {
        if (this.protocol === "OSCXR") {
            if (aux !== 1) {
                this.unsupportedForXR("Indexed aux inputs are not mapped; OSCXR exposes the aux return as /rtn/aux.");
            }
            return `/rtn/aux/mix/${this.getBusSendSegment(bus)}`;
        }
        return `/auxin/${aux.toString().padStart(2, "0")}/mix/${this.getBusSendSegment(bus)}`;
    }

    private getChannelBusMutePath(channel: number, bus: number): string {
        if (this.protocol === "OSCXR") {
            this.unsupportedForXR(
                `Channel-to-bus mute is not losslessly supported: OSCXR exposes /ch/${channel.toString().padStart(2, "0")}/mix/on as whole-channel mute, not bus ${bus} mute. Use osc_mute_channel for the global channel mute.`,
            );
        }
        return `${this.getChannelPath(channel)}/mix/${this.getBusSendSegment(bus)}/on`;
    }

    private getFxBusMutePath(effect: number, bus: number): string {
        if (this.protocol === "OSCXR") {
            this.unsupportedForXR(
                `FX-return-to-bus mute is not losslessly supported: OSCXR exposes /rtn/${effect}/mix/on as whole-return mute, not bus ${bus} mute. Use osc_set_effect_on for the global FX return mute.`,
            );
        }
        return `${this.getFxReturnPath(effect)}/mix/${this.getBusSendSegment(bus)}/on`;
    }

    private getAuxBusMutePath(aux: number, bus: number): string {
        if (this.protocol === "OSCXR") {
            this.unsupportedForXR(
                `Aux-return-to-bus mute is not losslessly supported: OSCXR exposes /rtn/aux/mix/on as whole-aux-return mute, not bus ${bus} mute. Use osc_mute_aux with aux 1 for the global aux return mute.`,
            );
        }
        return `${this.getAuxBusPath(aux, bus)}/on`;
    }

    private getHeadampPath(index: number): string {
        const width = this.protocol === "OSCXR" ? 2 : 3;
        return `/headamp/${index.toString().padStart(width, "0")}`;
    }

    private getSceneIndex(scene: number): number {
        return this.protocol === "OSCXR" ? scene : scene - 1;
    }

    private getSceneNamePath(scene: number): string {
        const index = this.getSceneIndex(scene);
        return this.protocol === "OSCXR"
            ? `/-snap/${index.toString().padStart(2, "0")}/name`
            : `/-show/showfile/scene/${index.toString().padStart(3, "0")}/name`;
    }

    private getSceneLoadPath(): string {
        return this.protocol === "OSCXR" ? "/-snap/load" : "/-action/goscene";
    }

    private getSceneSavePath(): string {
        return this.protocol === "OSCXR" ? "/-snap/save" : "/save";
    }

    private unsupportedForXR(detail: string): never {
        throw new Error(`Unsupported for OSCXR: ${detail}`);
    }

    private requireX32(feature: string): void {
        if (this.protocol === "OSCXR") {
            this.unsupportedForXR(`${feature} is not mapped in PROTOCOL.md yet.`);
        }
    }

    // ========== Channel Controls ==========

    async setFader(channel: number, level: number): Promise<void> {
        const path = `${this.getChannelPath(channel)}/mix/fader`;
        await this.writeAndVerify(path, [level], { label: `channel ${channel} fader` });
    }

    async setFaderUnchecked(channel: number, level: number): Promise<void> {
        const path = `${this.getChannelPath(channel)}/mix/fader`;
        await this.sendCommand(path, [level], { allowOfflineWrite: true });
    }

    async getFader(channel: number): Promise<number> {
        const path = `${this.getChannelPath(channel)}/mix/fader`;
        return await this.sendAndReceive(path);
    }

    async muteChannel(channel: number, mute: boolean): Promise<void> {
        const path = `${this.getChannelPath(channel)}/mix/on`;
        // Mixer uses 1 for ON (unmuted) and 0 for OFF (muted)
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `channel ${channel} mute` });
    }

    async getMute(channel: number): Promise<boolean> {
        const path = `${this.getChannelPath(channel)}/mix/on`;
        const value = await this.sendAndReceive(path);
        return value === 0;
    }

    async setPan(channel: number, pan: number): Promise<void> {
        this.requireX32("Channel pan");
        const path = `${this.getChannelPath(channel)}/mix/pan`;
        // Convert -1 to 1 range to 0 to 1 range (0 = left, 0.5 = center, 1 = right)
        const mixerPan = (pan + 1) / 2;
        await this.writeAndVerify(path, [mixerPan], { label: `channel ${channel} pan` });
    }

    async getPan(channel: number): Promise<number> {
        this.requireX32("Channel pan");
        const path = `${this.getChannelPath(channel)}/mix/pan`;
        const value = await this.sendAndReceive(path);
        // Convert 0-1 range to -1 to 1 range
        return value * 2 - 1;
    }

    async setChannelName(channel: number, name: string): Promise<void> {
        const path = `${this.getChannelPath(channel)}/config/name`;
        await this.writeAndVerify(path, [name], { tolerance: 0, label: `channel ${channel} name` });
    }

    async getChannelName(channel: number): Promise<string> {
        const path = `${this.getChannelPath(channel)}/config/name`;
        return await this.sendAndReceive(path);
    }

    async setChannelColor(channel: number, color: number): Promise<void> {
        this.requireX32("Channel color");
        const path = `${this.getChannelPath(channel)}/config/color`;
        await this.writeAndVerify(path, [color], { tolerance: 0, label: `channel ${channel} color` });
    }

    async getChannelColor(channel: number): Promise<number> {
        this.requireX32("Channel color");
        const path = `${this.getChannelPath(channel)}/config/color`;
        return await this.sendAndReceive(path);
    }

    async setChannelIcon(channel: number, icon: number): Promise<void> {
        this.requireX32("Channel icon");
        const path = `${this.getChannelPath(channel)}/config/icon`;
        await this.writeAndVerify(path, [icon], { tolerance: 0, label: `channel ${channel} icon` });
    }

    async getChannelIcon(channel: number): Promise<number> {
        this.requireX32("Channel icon");
        const path = `${this.getChannelPath(channel)}/config/icon`;
        return await this.sendAndReceive(path);
    }

    // Channel linking is per-pair. Addresses: /config/chlink/1-2, 3-4, ... 31-32.
    // Each returns int 0 (unlinked) or 1 (linked).
    async getChannelLinks(): Promise<Array<{ pair: string; linked: boolean }>> {
        this.requireX32("Channel links");
        const result: Array<{ pair: string; linked: boolean }> = [];
        for (let i = 1; i <= 31; i += 2) {
            const pair = `${i}-${i + 1}`;
            const v = await this.safeRead(`/config/chlink/${pair}`);
            result.push({ pair, linked: v === 1 });
        }
        return result;
    }

    async setChannelLink(pair: string, linked: boolean): Promise<void> {
        this.requireX32("Channel links");
        await this.writeAndVerify(`/config/chlink/${pair}`, [linked ? 1 : 0], { tolerance: 0, label: `channel pair ${pair} link` });
    }

    async getBusLinks(): Promise<Array<{ pair: string; linked: boolean }>> {
        this.requireX32("Bus links");
        const result: Array<{ pair: string; linked: boolean }> = [];
        for (let i = 1; i <= 15; i += 2) {
            const pair = `${i}-${i + 1}`;
            const v = await this.safeRead(`/config/buslink/${pair}`);
            result.push({ pair, linked: v === 1 });
        }
        return result;
    }

    async setBusLink(pair: string, linked: boolean): Promise<void> {
        this.requireX32("Bus links");
        await this.writeAndVerify(`/config/buslink/${pair}`, [linked ? 1 : 0], { tolerance: 0, label: `bus pair ${pair} link` });
    }
    

    // Read a block-level input routing assignment (8-ch group).
    async getRoutingBlockIn(block: string): Promise<{ raw: number; label: string } | null> {
        this.requireX32("Block routing");
        const raw = await this.safeRead(`/config/routing/IN/${block}`);
        if (raw === null) return null;
        return { raw, label: decodeBlockInSource(raw) };
    }

    // ========== EQ Controls ==========

    async setEQ(channel: number, band: number, gain: number): Promise<void> {
        const path = `${this.getChannelPath(channel)}/eq/${band}/g`;
        // Convert dB to mixer range (0.0 to 1.0, where 0.5 is 0dB)
        const mixerGain = (gain + 15) / 30; // -15dB to +15dB mapped to 0-1
        await this.writeAndVerify(path, [mixerGain], { label: `channel ${channel} EQ band ${band} gain` });
    }

    async getEQ(channel: number, band: number): Promise<number> {
        const path = `${this.getChannelPath(channel)}/eq/${band}/g`;
        const value = await this.sendAndReceive(path);
        // Convert mixer range to dB
        return value * 30 - 15;
    }

    async getEQFrequency(channel: number, band: number): Promise<number> {
        this.requireX32("Channel EQ frequency");
        const path = `${this.getChannelPath(channel)}/eq/${band}/f`;
        return await this.sendAndReceive(path);
    }

    async setEQFrequency(channel: number, band: number, frequency: number): Promise<void> {
        this.requireX32("Channel EQ frequency");
        const path = `${this.getChannelPath(channel)}/eq/${band}/f`;
        await this.writeAndVerify(path, [frequency], { label: `channel ${channel} EQ band ${band} frequency` });
    }

    async getEQQ(channel: number, band: number): Promise<number> {
        this.requireX32("Channel EQ Q");
        const path = `${this.getChannelPath(channel)}/eq/${band}/q`;
        return await this.sendAndReceive(path);
    }

    async setEQQ(channel: number, band: number, q: number): Promise<void> {
        this.requireX32("Channel EQ Q");
        const path = `${this.getChannelPath(channel)}/eq/${band}/q`;
        await this.writeAndVerify(path, [q], { label: `channel ${channel} EQ band ${band} Q` });
    }

    async getEQType(channel: number, band: number): Promise<number> {
        this.requireX32("Channel EQ type");
        const path = `${this.getChannelPath(channel)}/eq/${band}/type`;
        return await this.sendAndReceive(path);
    }

    async setEQType(channel: number, band: number, type: number): Promise<void> {
        this.requireX32("Channel EQ type");
        const path = `${this.getChannelPath(channel)}/eq/${band}/type`;
        await this.writeAndVerify(path, [type], { tolerance: 0, label: `channel ${channel} EQ band ${band} type` });
    }

    async getEQOn(channel: number): Promise<boolean> {
        const path = `${this.getChannelPath(channel)}/eq/on`;
        const value = await this.sendAndReceive(path);
        return value === 1;
    }

    async setEQOn(channel: number, on: boolean): Promise<void> {
        const path = `${this.getChannelPath(channel)}/eq/on`;
        await this.writeAndVerify(path, [on ? 1 : 0], { tolerance: 0, label: `channel ${channel} EQ on` });
    }

    // ========== Dynamics Controls ==========

    async setGate(channel: number, threshold: number): Promise<void> {
        this.requireX32("Channel gate");
        const path = `${this.getChannelPath(channel)}/gate/thr`;
        // Convert dB to mixer range
        const mixerThreshold = (threshold + 80) / 80; // -80dB to 0dB mapped to 0-1
        await this.writeAndVerify(path, [mixerThreshold], { label: `channel ${channel} gate threshold` });
    }

    async getGate(channel: number): Promise<number> {
        this.requireX32("Channel gate");
        const path = `${this.getChannelPath(channel)}/gate/thr`;
        const value = await this.sendAndReceive(path);
        return value * 80 - 80;
    }

    async setGateRange(channel: number, range: number): Promise<void> {
        this.requireX32("Channel gate");
        const path = `${this.getChannelPath(channel)}/gate/range`;
        await this.writeAndVerify(path, [range], { label: `channel ${channel} gate range` });
    }

    async setGateAttack(channel: number, attack: number): Promise<void> {
        this.requireX32("Channel gate");
        const path = `${this.getChannelPath(channel)}/gate/attack`;
        await this.writeAndVerify(path, [attack], { label: `channel ${channel} gate attack` });
    }

    async setGateHold(channel: number, hold: number): Promise<void> {
        this.requireX32("Channel gate");
        const path = `${this.getChannelPath(channel)}/gate/hold`;
        await this.writeAndVerify(path, [hold], { label: `channel ${channel} gate hold` });
    }

    async setGateRelease(channel: number, release: number): Promise<void> {
        this.requireX32("Channel gate");
        const path = `${this.getChannelPath(channel)}/gate/release`;
        await this.writeAndVerify(path, [release], { label: `channel ${channel} gate release` });
    }

    async setGateOn(channel: number, on: boolean): Promise<void> {
        this.requireX32("Channel gate");
        const path = `${this.getChannelPath(channel)}/gate/on`;
        await this.writeAndVerify(path, [on ? 1 : 0], { tolerance: 0, label: `channel ${channel} gate on` });
    }

    async setCompressor(
        channel: number,
        threshold: number,
        ratio: number
    ): Promise<void> {
        this.requireX32("Channel compressor");
        const thrPath = `${this.getChannelPath(channel)}/dyn/thr`;
        const ratioPath = `${this.getChannelPath(channel)}/dyn/ratio`;

        // Convert threshold dB to mixer range
        const mixerThreshold = (threshold + 60) / 60; // -60dB to 0dB mapped to 0-1
        await this.writeAndVerify(thrPath, [mixerThreshold], { label: `channel ${channel} compressor threshold` });

        // Convert ratio to mixer range
        const mixerRatio = (ratio - 1) / 19; // 1:1 to 20:1 mapped to 0-1
        await this.writeAndVerify(ratioPath, [mixerRatio], { label: `channel ${channel} compressor ratio` });
    }

    async setCompressorAttack(channel: number, attack: number): Promise<void> {
        this.requireX32("Channel compressor");
        const path = `${this.getChannelPath(channel)}/dyn/attack`;
        await this.writeAndVerify(path, [attack], { label: `channel ${channel} compressor attack` });
    }

    async setCompressorRelease(channel: number, release: number): Promise<void> {
        this.requireX32("Channel compressor");
        const path = `${this.getChannelPath(channel)}/dyn/release`;
        await this.writeAndVerify(path, [release], { label: `channel ${channel} compressor release` });
    }

    async setCompressorKnee(channel: number, knee: number): Promise<void> {
        this.requireX32("Channel compressor");
        const path = `${this.getChannelPath(channel)}/dyn/knee`;
        await this.writeAndVerify(path, [knee], { label: `channel ${channel} compressor knee` });
    }

    async setCompressorGain(channel: number, gain: number): Promise<void> {
        this.requireX32("Channel compressor");
        const path = `${this.getChannelPath(channel)}/dyn/gain`;
        await this.writeAndVerify(path, [gain], { label: `channel ${channel} compressor gain` });
    }

    async setCompressorOn(channel: number, on: boolean): Promise<void> {
        this.requireX32("Channel compressor");
        const path = `${this.getChannelPath(channel)}/dyn/on`;
        await this.writeAndVerify(path, [on ? 1 : 0], { tolerance: 0, label: `channel ${channel} compressor on` });
    }

    // ========== Bus Controls ==========

    async setBusFader(bus: number, level: number): Promise<void> {
        const path = `${this.getBusPath(bus)}/mix/fader`;
        await this.writeAndVerify(path, [level], { label: `bus ${bus} fader` });
    }

    async getBusFader(bus: number): Promise<number> {
        const path = `${this.getBusPath(bus)}/mix/fader`;
        return await this.sendAndReceive(path);
    }

    async muteBus(bus: number, mute: boolean): Promise<void> {
        const path = `${this.getBusPath(bus)}/mix/on`;
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `bus ${bus} mute` });
    }

    async muteBusUnchecked(bus: number, mute: boolean): Promise<void> {
        const path = `${this.getBusPath(bus)}/mix/on`;
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `bus ${bus} mute` });
    }

    async setBusPan(bus: number, pan: number): Promise<void> {
        this.requireX32("Bus pan");
        const path = `${this.getBusPath(bus)}/mix/pan`;
        const mixerPan = (pan + 1) / 2;
        await this.writeAndVerify(path, [mixerPan], { label: `bus ${bus} pan` });
    }

    async setBusName(bus: number, name: string): Promise<void> {
        const path = `${this.getBusPath(bus)}/config/name`;
        await this.writeAndVerify(path, [name], { tolerance: 0, label: `bus ${bus} name` });
    }

    async getBusName(bus: number): Promise<string> {
        const path = `${this.getBusPath(bus)}/config/name`;
        return await this.sendAndReceive(path);
    }

    // ========== Aux Controls ==========

    async setAuxFader(aux: number, level: number): Promise<void> {
        const path = `${this.getAuxPath(aux)}/mix/fader`;
        await this.writeAndVerify(path, [level], { label: `aux ${aux} fader` });
    }

    async getAuxFader(aux: number): Promise<number> {
        const path = `${this.getAuxPath(aux)}/mix/fader`;
        return await this.sendAndReceive(path);
    }

    async getAuxName(aux: number): Promise<string> {
        const path = `${this.getAuxPath(aux)}/config/name`;
        return await this.sendAndReceive(path);
    }

    async muteAux(aux: number, mute: boolean): Promise<void> {
        const path = `${this.getAuxPath(aux)}/mix/on`;
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `aux ${aux} mute` });
    }

    async setAuxPan(aux: number, pan: number): Promise<void> {
        this.requireX32("Aux pan");
        const path = `${this.getAuxPath(aux)}/mix/pan`;
        const mixerPan = (pan + 1) / 2;
        await this.writeAndVerify(path, [mixerPan], { label: `aux ${aux} pan` });
    }

    // ========== Sends ==========

    async sendToBus(channel: number, bus: number, level: number): Promise<void> {
        const path = `${this.getChannelPath(channel)}/mix/${this.getBusSendSegment(bus)}/level`;
        await this.writeAndVerify(path, [level], { label: `channel ${channel} send to bus ${bus}` });
    }

    async sendToBusUnchecked(channel: number, bus: number, level: number): Promise<void> {
        const path = `${this.getChannelPath(channel)}/mix/${this.getBusSendSegment(bus)}/level`;
        await this.writeAndVerify(path, [level], { label: `channel ${channel} send to bus ${bus}` });
    }

    async getSendToBus(channel: number, bus: number): Promise<number> {
        const path = `${this.getChannelPath(channel)}/mix/${this.getBusSendSegment(bus)}/level`;
        return await this.sendAndReceive(path);
    }

    async muteChannelToBus(channel: number, bus: number, mute: boolean): Promise<void> {
        const path = this.getChannelBusMutePath(channel, bus);
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `channel ${channel} send mute to bus ${bus}` });
    }

    async sendFxToBus(effect: number, bus: number, level: number): Promise<void> {
        const path = `${this.getFxReturnPath(effect)}/mix/${this.getBusSendSegment(bus)}/level`;
        await this.writeAndVerify(path, [level], { label: `FX return ${effect} send to bus ${bus}` });
    }

    async getFxToBus(effect: number, bus: number): Promise<number> {
        const path = `${this.getFxReturnPath(effect)}/mix/${this.getBusSendSegment(bus)}/level`;
        return await this.sendAndReceive(path);
    }

    async getFxReturnName(effect: number): Promise<string> {
        const path = `${this.getFxReturnPath(effect)}/config/name`;
        return await this.sendAndReceive(path);
    }

    async setFxReturnFader(effect: number, level: number): Promise<void> {
        const path = `${this.getFxReturnPath(effect)}/mix/fader`;
        await this.writeAndVerify(path, [level], { label: `FX return ${effect} fader` });
    }

    async getFxReturnFader(effect: number): Promise<number> {
        const path = `${this.getFxReturnPath(effect)}/mix/fader`;
        return await this.sendAndReceive(path);
    }

    async muteFxToBus(effect: number, bus: number, mute: boolean): Promise<void> {
        const path = this.getFxBusMutePath(effect, bus);
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `FX return ${effect} send mute to bus ${bus}` });
    }

    async sendAuxToBus(aux: number, bus: number, level: number): Promise<void> {
        const path = `${this.getAuxBusPath(aux, bus)}/level`;
        await this.writeAndVerify(path, [level], { label: `aux ${aux} send to bus ${bus}` });
    }

    async getAuxToBus(aux: number, bus: number): Promise<number> {
        const path = `${this.getAuxBusPath(aux, bus)}/level`;
        return await this.sendAndReceive(path);
    }

    async muteAuxToBus(aux: number, bus: number, mute: boolean): Promise<void> {
        const path = this.getAuxBusMutePath(aux, bus);
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `aux ${aux} send mute to bus ${bus}` });
    }

    async sendToAux(channel: number, aux: number, level: number): Promise<void> {
        this.requireX32("Channel sends to aux");
        const path = `${this.getChannelPath(channel)}/mix/${(aux + 15).toString().padStart(2, "0")}/level`;
        await this.writeAndVerify(path, [level], { label: `channel ${channel} send to aux ${aux}` });
    }

    async setSendPrePost(channel: number, bus: number, pre: boolean): Promise<void> {
        this.requireX32("Send pre/post");
        const path = `${this.getChannelPath(channel)}/mix/${bus.toString().padStart(2, "0")}/preamp`;
        await this.writeAndVerify(path, [pre ? 1 : 0], { tolerance: 0, label: `channel ${channel} send pre/post to bus ${bus}` });
    }

    // ========== Main Mix ==========

    async setMainFader(level: number): Promise<void> {
        await this.writeAndVerify(`${this.getMainStereoPath()}/mix/fader`, [level], { label: "main LR fader" });
    }

    async getMainFader(): Promise<number> {
        return await this.sendAndReceive(`${this.getMainStereoPath()}/mix/fader`);
    }

    async muteMain(mute: boolean): Promise<void> {
        await this.writeAndVerify(`${this.getMainStereoPath()}/mix/on`, [mute ? 0 : 1], { tolerance: 0, label: "main LR mute" });
    }

    async setMainPan(pan: number): Promise<void> {
        this.requireX32("Main pan");
        const path = `${this.getMainStereoPath()}/mix/pan`;
        const mixerPan = (pan + 1) / 2;
        await this.writeAndVerify(path, [mixerPan], { label: "main LR pan" });
    }

    // ========== Matrix ==========

    async setMatrixFader(matrix: number, level: number): Promise<void> {
        this.requireX32("Matrix controls");
        const path = `/mtx/${matrix.toString().padStart(2, "0")}/mix/fader`;
        await this.writeAndVerify(path, [level], { label: `matrix ${matrix} fader` });
    }

    async getMatrixFader(matrix: number): Promise<number> {
        this.requireX32("Matrix controls");
        const path = `/mtx/${matrix.toString().padStart(2, "0")}/mix/fader`;
        return await this.sendAndReceive(path);
    }

    async getMatrixName(matrix: number): Promise<string> {
        this.requireX32("Matrix name");
        const path = `/mtx/${matrix.toString().padStart(2, "0")}/config/name`;
        return await this.sendAndReceive(path);
    }

    async muteMatrix(matrix: number, mute: boolean): Promise<void> {
        this.requireX32("Matrix controls");
        const path = `/mtx/${matrix.toString().padStart(2, "0")}/mix/on`;
        await this.writeAndVerify(path, [mute ? 0 : 1], { tolerance: 0, label: `matrix ${matrix} mute` });
    }

    // ========== Effects ==========

    private getFxPath(effect: number): string {
        return `/fx/${effect}`;
    }

    async getEffectType(effect: number): Promise<number> {
        this.requireX32("Effect type");
        return await this.sendAndReceive(`${this.getFxPath(effect)}/type`);
    }

    // NOTE: X32 has no /fx/N/on or /fx/N/mix addresses. FX slots are always
    // instantiated; "on/off" is controlled by whether the FX return fader/mute
    // is up, and wet/dry is an internal FX parameter (varies by algorithm).
    // Use getFxReturnStrip() to check if an FX is effectively active.

    async setEffectOn(effect: number, on: boolean): Promise<void> {
        // Rewired: mute/unmute the corresponding FX return channel
        const fxrPath = `${this.getFxReturnPath(effect)}/mix/on`;
        await this.writeAndVerify(fxrPath, [on ? 1 : 0], { tolerance: 0, label: `FX return ${effect} mute` });
    }

    async getEffectOn(effect: number): Promise<boolean> {
        // Rewired: read the FX return channel mute state
        const fxrPath = `${this.getFxReturnPath(effect)}/mix/on`;
        const value = await this.sendAndReceive(fxrPath);
        return value === 1;
    }

    async setEffectParam(effect: number, param: number, value: number): Promise<void> {
        if (this.protocol === "OSCXR" && param !== 1) {
            this.unsupportedForXR("Only FX parameter 1 is mapped in PROTOCOL.md.");
        }
        await this.writeAndVerify(`${this.getFxPath(effect)}/par/${param.toString().padStart(2, "0")}`, [value], { label: `FX slot ${effect} parameter ${param}` });
    }

    async getEffectParam(effect: number, param: number): Promise<number> {
        if (this.protocol === "OSCXR" && param !== 1) {
            this.unsupportedForXR("Only FX parameter 1 is mapped in PROTOCOL.md.");
        }
        return await this.sendAndReceive(`${this.getFxPath(effect)}/par/${param.toString().padStart(2, "0")}`);
    }

    // ========== Routing ==========

    async setChannelSource(channel: number, source: number): Promise<void> {
        this.requireX32("Channel source");
        const path = `${this.getChannelPath(channel)}/config/source`;
        await this.writeAndVerify(path, [source], { tolerance: 0, label: `channel ${channel} source` });
    }

    async getChannelSource(channel: number): Promise<number> {
        this.requireX32("Channel source");
        const path = `${this.getChannelPath(channel)}/config/source`;
        return await this.sendAndReceive(path);
    }

    // ========== Scenes ==========

    async recallScene(scene: number): Promise<void> {
        const path = this.getSceneLoadPath();
        await this.sendCommand(path, [this.getSceneIndex(scene)]);
    }

    async saveScene(scene: number, name?: string): Promise<void> {
        const path = this.getSceneSavePath();
        await this.sendCommand(path, [this.getSceneIndex(scene)]);
        if (name) {
            const namePath = this.getSceneNamePath(scene);
            await this.sendCommand(namePath, [name]);
        }
    }

    async getSceneName(scene: number): Promise<string> {
        const path = this.getSceneNamePath(scene);
        return await this.sendAndReceive(path);
    }

    // ========== Meters ==========

    async getChannelMeter(channel: number): Promise<number> {
        const path = `${this.getChannelPath(channel)}/mix/fader`;
        // Note: Meters are typically sent automatically by the mixer
        // This is a placeholder - actual meter data comes via /meters
        return await this.sendAndReceive(path);
    }

    // ========== Status ==========

    async getMixerStatus(): Promise<any> {
        this.lastHealthCheckAt = new Date();
        try {
            const xinfoArgs = await this.sendAndReceiveArgs("/xinfo");
            const [networkAddress, networkName, consoleModel, consoleVersion] = xinfoArgs;
            this.mixerOnline = true;
            this.lastHealthError = null;

            return {
                connected: true,
                mixerOnline: this.mixerOnline,
                checkSource: "live_xinfo",
                host: this.host,
                port: this.port,
                protocol: this.protocol,
                lastHealthCheckAt: this.lastHealthCheckAt.toISOString(),
                lastHealthError: this.lastHealthError,
                xinfo: {
                    networkAddress,
                    networkName,
                    consoleModel,
                    consoleVersion,
                    raw: xinfoArgs,
                },
            };
        } catch (error) {
            this.mixerOnline = false;
            this.lastHealthError = error instanceof Error ? error.message : String(error);
            return {
                connected: false,
                mixerOnline: this.mixerOnline,
                checkSource: "live_xinfo",
                host: this.host,
                port: this.port,
                protocol: this.protocol,
                lastHealthCheckAt: this.lastHealthCheckAt.toISOString(),
                lastHealthError: this.lastHealthError,
                error: this.lastHealthError,
            };
        }
    }

    // ========== Bulk Reads ==========

    private async safeRead(address: string): Promise<any> {
        try { return await this.sendAndReceive(address); } catch { return null; }
    }

    private async readEQBands(path: string, bands: number = 4): Promise<any> {
        const eqOn = await this.safeRead(`${path}/eq/on`);
        const eq: any[] = [];
        for (let b = 1; b <= bands; b++) {
            const band: any = {
                band: b,
                gain: await this.safeRead(`${path}/eq/${b}/g`),
            };
            if (this.protocol !== "OSCXR") {
                band.freq = await this.safeRead(`${path}/eq/${b}/f`);
                band.q = await this.safeRead(`${path}/eq/${b}/q`);
                band.type = await this.safeRead(`${path}/eq/${b}/type`);
            }
            eq.push(band);
        }
        return { eqOn: eqOn === 1, eq };
    }

    async getChannelStrip(channel: number): Promise<any> {
        const path = this.getChannelPath(channel);
        const result: any = { channel };

        result.name = await this.safeRead(`${path}/config/name`);
        result.fader = await this.safeRead(`${path}/mix/fader`);
        result.on = (await this.safeRead(`${path}/mix/on`)) === 1;

        // EQ (4-band)
        const eqData = await this.readEQBands(path, 4);
        result.eqOn = eqData.eqOn;
        result.eq = eqData.eq;

        if (this.protocol === "OSCXR") {
            result.headampGain = await this.safeRead(`${this.getHeadampPath(channel)}/gain`);
            result.unsupportedFields = ["pan", "color", "icon", "source", "gate", "compressor", "sendPan", "sendType"];
        } else {
            result.pan = await this.safeRead(`${path}/mix/pan`);
            result.color = await this.safeRead(`${path}/config/color`);
            result.source = await this.safeRead(`${path}/config/source`);

            // Headamp (preamp gain + phantom)
            const src = result.source;
            if (src !== null && src >= 0 && src < 64) {
                result.headampGain = await this.safeRead(`${this.getHeadampPath(src)}/gain`);
                result.headampPhantom = await this.safeRead(`${this.getHeadampPath(src)}/phantom`);
            }
        }

        if (this.protocol === "OSCXR") {
            result.sends = [];
            for (let b = 1; b <= this.busCount; b++) {
                const sendPath = `${path}/mix/${b.toString().padStart(2, "0")}`;
                result.sends.push({
                    bus: b,
                    level: await this.safeRead(`${sendPath}/level`),
                });
            }
            return result;
        }

        // Gate (full)
        result.gateOn = (await this.safeRead(`${path}/gate/on`)) === 1;
        result.gateThr = await this.safeRead(`${path}/gate/thr`);
        result.gateRange = await this.safeRead(`${path}/gate/range`);
        result.gateAttack = await this.safeRead(`${path}/gate/attack`);
        result.gateHold = await this.safeRead(`${path}/gate/hold`);
        result.gateRelease = await this.safeRead(`${path}/gate/release`);

        // Compressor (full)
        result.dynOn = (await this.safeRead(`${path}/dyn/on`)) === 1;
        result.dynThr = await this.safeRead(`${path}/dyn/thr`);
        result.dynRatio = await this.safeRead(`${path}/dyn/ratio`);
        result.dynAttack = await this.safeRead(`${path}/dyn/attack`);
        result.dynRelease = await this.safeRead(`${path}/dyn/release`);
        result.dynKnee = await this.safeRead(`${path}/dyn/knee`);
        result.dynGain = await this.safeRead(`${path}/dyn/gain`);

        // Sends to buses
        result.sends = [];
        for (let b = 1; b <= this.busCount; b++) {
            const sendPath = `${path}/mix/${b.toString().padStart(2, "0")}`;
            result.sends.push({
                bus: b,
                level: await this.safeRead(`${sendPath}/level`),
                pan: await this.safeRead(`${sendPath}/pan`),
                type: await this.safeRead(`${sendPath}/type`),
            });
        }

        return result;
    }

    async getBusStrip(bus: number): Promise<any> {
        const path = this.getBusPath(bus);
        const result: any = { bus };

        result.name = await this.safeRead(`${path}/config/name`);
        result.fader = await this.safeRead(`${path}/mix/fader`);
        result.on = (await this.safeRead(`${path}/mix/on`)) === 1;

        const eqData = await this.readEQBands(path, 4);
        result.eqOn = eqData.eqOn;
        result.eq = eqData.eq;

        if (this.protocol === "OSCXR") {
            result.unsupportedFields = ["pan", "color", "compressor"];
            return result;
        }

        result.pan = await this.safeRead(`${path}/mix/pan`);
        result.color = await this.safeRead(`${path}/config/color`);

        // Dynamics
        result.dynOn = (await this.safeRead(`${path}/dyn/on`)) === 1;
        result.dynThr = await this.safeRead(`${path}/dyn/thr`);
        result.dynRatio = await this.safeRead(`${path}/dyn/ratio`);

        return result;
    }

    async getAuxStrip(aux: number): Promise<any> {
        const path = this.getAuxPath(aux);
        const result: any = { aux };

        result.name = await this.safeRead(`${path}/config/name`);
        result.fader = await this.safeRead(`${path}/mix/fader`);
        result.on = (await this.safeRead(`${path}/mix/on`)) === 1;
        if (this.protocol === "OSCXR") {
            result.unsupportedFields = ["pan", "color", "source"];
            return result;
        }
        result.pan = await this.safeRead(`${path}/mix/pan`);
        result.color = await this.safeRead(`${path}/config/color`);
        result.source = await this.safeRead(`${path}/config/source`);

        return result;
    }

    async getFxReturnStrip(fxr: number): Promise<any> {
        const path = this.getFxReturnPath(fxr);
        const result: any = { fxReturn: fxr };

        result.name = await this.safeRead(`${path}/config/name`);
        result.fader = await this.safeRead(`${path}/mix/fader`);
        result.on = (await this.safeRead(`${path}/mix/on`)) === 1;
        if (this.protocol === "OSCXR") {
            result.unsupportedFields = ["pan", "color"];
            return result;
        }
        result.pan = await this.safeRead(`${path}/mix/pan`);
        result.color = await this.safeRead(`${path}/config/color`);

        return result;
    }

    async getMatrixStrip(mtx: number): Promise<any> {
        this.requireX32("Matrix strip");
        const path = `/mtx/${mtx.toString().padStart(2, "0")}`;
        const result: any = { matrix: mtx };

        result.name = await this.safeRead(`${path}/config/name`);
        result.fader = await this.safeRead(`${path}/mix/fader`);
        result.on = (await this.safeRead(`${path}/mix/on`)) === 1;
        result.pan = await this.safeRead(`${path}/mix/pan`);

        const eqData = await this.readEQBands(path, 4);
        result.eqOn = eqData.eqOn;
        result.eq = eqData.eq;

        return result;
    }

    async getDCA(dca: number): Promise<any> {
        const path = `/dca/${dca}`;
        const result: any = { dca };

        result.name = await this.safeRead(`${path}/config/name`);
        result.fader = await this.safeRead(`${path}/fader`);
        result.on = (await this.safeRead(`${path}/on`)) === 1;
        if (this.protocol === "OSCXR") {
            result.unsupportedFields = ["color"];
            return result;
        }
        result.color = await this.safeRead(`${path}/config/color`);

        return result;
    }

    async getDcaName(dca: number): Promise<string> {
        const path = `/dca/${dca}/config/name`;
        return await this.sendAndReceive(path);
    }

    async getMainStrip(): Promise<any> {
        const result: any = { type: "main_stereo" };

        result.name = await this.safeRead(`${this.getMainStereoPath()}/config/name`);
        result.fader = await this.safeRead(`${this.getMainStereoPath()}/mix/fader`);
        result.on = (await this.safeRead(`${this.getMainStereoPath()}/mix/on`)) === 1;
        if (this.protocol === "OSCXR") {
            result.unsupportedFields = ["pan", "mainEq", "compressor", "mono"];
            return result;
        }
        result.pan = await this.safeRead(`${this.getMainStereoPath()}/mix/pan`);

        const eqData = await this.readEQBands(this.getMainStereoPath(), 6);
        result.eqOn = eqData.eqOn;
        result.eq = eqData.eq;

        // Dynamics
        result.dynOn = (await this.safeRead(`${this.getMainStereoPath()}/dyn/on`)) === 1;
        result.dynThr = await this.safeRead(`${this.getMainStereoPath()}/dyn/thr`);
        result.dynRatio = await this.safeRead(`${this.getMainStereoPath()}/dyn/ratio`);

        // Mono bus
        result.mono = {
            fader: await this.safeRead("/main/m/mix/fader"),
            on: (await this.safeRead("/main/m/mix/on")) === 1,
        };

        return result;
    }

    async getHeadamp(index: number): Promise<any> {
        const path = this.getHeadampPath(index);
        if (this.protocol === "OSCXR") {
            return {
                index,
                gain: await this.safeRead(`${path}/gain`),
                unsupportedFields: ["phantom"],
            };
        }
        return {
            index,
            gain: await this.safeRead(`${path}/gain`),
            phantom: (await this.safeRead(`${path}/phantom`)) === 1,
        };
    }

    async getConsoleOverview(): Promise<any> {
        if (this.protocol === "OSCXR") {
            this.unsupportedForXR("Console overview needs model-specific channel/bus limits before it can avoid large timeout-heavy reads.");
        }
        const overview: any = {};

        // All channels - name, fader, mute only for speed
        overview.channels = [];
        for (let ch = 1; ch <= this.channelCount; ch++) {
            const path = this.getChannelPath(ch);
            overview.channels.push({
                ch,
                name: await this.safeRead(`${path}/config/name`),
                fader: await this.safeRead(`${path}/mix/fader`),
                on: (await this.safeRead(`${path}/mix/on`)) === 1,
            });
        }

        // Mix buses
        overview.buses = [];
        for (let b = 1; b <= this.busCount; b++) {
            const path = this.getBusPath(b);
            overview.buses.push({
                bus: b,
                name: await this.safeRead(`${path}/config/name`),
                fader: await this.safeRead(`${path}/mix/fader`),
                on: (await this.safeRead(`${path}/mix/on`)) === 1,
            });
        }

        // DCA groups
        overview.dcas = [];
        for (let d = 1; d <= this.dcaCount; d++) {
            overview.dcas.push({
                dca: d,
                name: await this.safeRead(`/dca/${d}/config/name`),
                fader: await this.safeRead(`/dca/${d}/fader`),
                on: (await this.safeRead(`/dca/${d}/on`)) === 1,
            });
        }

        // 6 matrices
        overview.matrices = [];
        for (let m = 1; m <= 6; m++) {
            const path = `/mtx/${m.toString().padStart(2, "0")}`;
            overview.matrices.push({
                matrix: m,
                name: await this.safeRead(`${path}/config/name`),
                fader: await this.safeRead(`${path}/mix/fader`),
                on: (await this.safeRead(`${path}/mix/on`)) === 1,
            });
        }

        // 8 aux inputs
        overview.auxInputs = [];
        for (let a = 1; a <= 8; a++) {
            const path = `/auxin/${a.toString().padStart(2, "0")}`;
            overview.auxInputs.push({
                aux: a,
                name: await this.safeRead(`${path}/config/name`),
                fader: await this.safeRead(`${path}/mix/fader`),
                on: (await this.safeRead(`${path}/mix/on`)) === 1,
            });
        }

        // FX returns
        overview.fxReturns = [];
        for (let f = 1; f <= this.fxCount; f++) {
            const path = `/fxrtn/${f.toString().padStart(2, "0")}`;
            overview.fxReturns.push({
                fxReturn: f,
                name: await this.safeRead(`${path}/config/name`),
                fader: await this.safeRead(`${path}/mix/fader`),
                on: (await this.safeRead(`${path}/mix/on`)) === 1,
            });
        }

        // FX slots
        overview.fxSlots = [];
        for (let fx = 1; fx <= this.fxCount; fx++) {
            overview.fxSlots.push({
                slot: fx,
                type: await this.safeRead(`/fx/${fx}/type`),
            });
        }

        // Main
        overview.main = {
            fader: await this.safeRead(`${this.getMainStereoPath()}/mix/fader`),
            on: (await this.safeRead(`${this.getMainStereoPath()}/mix/on`)) === 1,
            monoFader: await this.safeRead("/main/m/mix/fader"),
            monoOn: (await this.safeRead("/main/m/mix/on")) === 1,
        };

        return overview;
    }

    async getRouting(): Promise<any> {
        this.requireX32("Routing overview");
        const routing: any = {};

        // FX source assignments (FX 1-4 are stereo insert, later slots are dual mono)
        routing.fxSources = [];
        for (let fx = 1; fx <= Math.min(4, this.fxCount); fx++) {
            routing.fxSources.push({
                slot: fx,
                sourceL: await this.safeRead(`/fx/${fx}/source/l`),
                sourceR: await this.safeRead(`/fx/${fx}/source/r`),
            });
        }
        // FX 5+ are inserted on channels, different structure
        for (let fx = 5; fx <= this.fxCount; fx++) {
            routing.fxSources.push({
                slot: fx,
                source: await this.safeRead(`/fx/${fx}/source`),
            });
        }

        // Output routing blocks
        routing.outputs = {};
        for (const block of ["1-4", "5-8", "9-12", "13-16"]) {
            routing.outputs[`OUT_${block}`] = await this.safeRead(`/config/routing/OUT/${block}`);
        }

        // Input routing blocks (decoded)
        routing.inputs = {};
        for (const block of ["1-8", "9-16", "17-24", "25-32"]) {
            const raw = await this.safeRead(`/config/routing/IN/${block}`);
            routing.inputs[`IN_${block}`] = { raw, label: raw === null ? null : decodeBlockInSource(raw) };
        }

        // AES50 routing (decoded using same block-in enum)
        routing.aes50a = {};
        for (const block of ["1-8", "9-16", "17-24", "25-32", "33-40", "41-48"]) {
            const raw = await this.safeRead(`/config/routing/AES50A/${block}`);
            routing.aes50a[`AES50A_${block}`] = { raw, label: raw === null ? null : decodeBlockInSource(raw) };
        }
        routing.aes50b = {};
        for (const block of ["1-8", "9-16", "17-24", "25-32", "33-40", "41-48"]) {
            const raw = await this.safeRead(`/config/routing/AES50B/${block}`);
            routing.aes50b[`AES50B_${block}`] = { raw, label: raw === null ? null : decodeBlockInSource(raw) };
        }

        // Card routing (decoded)
        routing.card = {};
        for (const block of ["1-8", "9-16", "17-24", "25-32"]) {
            const raw = await this.safeRead(`/config/routing/CARD/${block}`);
            routing.card[`CARD_${block}`] = { raw, label: raw === null ? null : decodeBlockInSource(raw) };
        }

        return routing;
    }

    // User-defined routing (firmware 4.0+): per-slot patches for the "User In"
    // and "User Out" blocks. When a routing block is set to source type
    // "USER IN" / "USER OUT", these tables determine the actual per-channel source.
    /**
     * Single-call summary of ALL routing layers, decoded. Returns:
     *  - inputBlocks: 4 block assignments (which source group feeds each 8-ch range)
     *  - outputBlocks, aes50a, aes50b, card: same structure for other directions
     *  - userIn: 32 per-slot patches (firmware 4.0+ 1:1 routing)
     *  - userOut: 48 per-slot patches
     *
     * Use this FIRST when planning routing changes — it shows the full topology so you can tell
     * whether a channel is patched via block routing (legacy 8-ch groups) or per-slot User In (firmware 4.0+).
     * If an input block shows "User In 25-32", per-channel patches live in userIn[24..31].
     */
    async getRoutingOverview(): Promise<any> {
        this.requireX32("Routing overview");
        const routing = await this.getRouting();
        const userRouting = await this.getUserRouting();
        return {
            summary: "X32 routing topology. Input blocks select which 8-ch source group feeds each channel range. When a block is set to 'User In N-M', the userIn per-slot table determines the actual physical source for each channel in that range.",
            inputBlocks: routing.inputs,
            outputBlocks: routing.outputs,
            aes50a: routing.aes50a,
            aes50b: routing.aes50b,
            card: routing.card,
            userIn: userRouting.userIn,
            userOut: userRouting.userOut,
        };
    }

    async getUserRouting(): Promise<any> {
        this.requireX32("User routing");
        const userRouting: any = { userIn: [], userOut: [] };

        for (let slot = 1; slot <= 32; slot++) {
            const source = await this.safeRead(`/config/userrout/in/${slot.toString().padStart(2, "0")}`);
            userRouting.userIn.push({
                slot,
                source,
                sourceLabel: source === null ? null : decodeUserInSource(source),
            });
        }

        for (let slot = 1; slot <= 48; slot++) {
            const source = await this.safeRead(`/config/userrout/out/${slot.toString().padStart(2, "0")}`);
            userRouting.userOut.push({
                slot,
                source,
                sourceLabel: source === null ? null : decodeUserOutSource(source),
            });
        }

        return userRouting;
    }

    /**
     * Set a User In slot's source. Accepts either a raw int (0..168) or a label like "Card 1", "Local 27", "AES50A 5", "OFF".
     */
    async setUserRoutingIn(slot: number, source: number | string): Promise<void> {
        this.requireX32("User routing");
        const code = encodeUserInSource(source);
        const path = `/config/userrout/in/${slot.toString().padStart(2, "0")}`;
        await this.writeAndVerify(path, [code], { tolerance: 0, label: `User In slot ${slot}` });
    }

    async getUserRoutingIn(slot: number): Promise<{ source: number; sourceLabel: string }> {
        this.requireX32("User routing");
        const path = `/config/userrout/in/${slot.toString().padStart(2, "0")}`;
        const source = await this.sendAndReceive(path);
        return { source, sourceLabel: decodeUserInSource(source) };
    }

    async setUserRoutingOut(slot: number, source: number): Promise<void> {
        this.requireX32("User routing");
        const path = `/config/userrout/out/${slot.toString().padStart(2, "0")}`;
        await this.writeAndVerify(path, [source], { tolerance: 0, label: `User Out slot ${slot}` });
    }

    async getUserRoutingOut(slot: number): Promise<{ source: number; sourceLabel: string }> {
        this.requireX32("User routing");
        const path = `/config/userrout/out/${slot.toString().padStart(2, "0")}`;
        const source = await this.sendAndReceive(path);
        return { source, sourceLabel: decodeUserOutSource(source) };
    }

    async getFullFxChain(): Promise<any[]> {
        if (this.protocol === "OSCXR") {
            this.unsupportedForXR("Full FX chain includes source assignment fields not mapped in PROTOCOL.md yet; use osc_get_all_effects and osc_get_fxreturn_strip.");
        }
        // For each FX slot: type, source assignment, params, and FX return state
        const chains: any[] = [];
        for (let fx = 1; fx <= this.fxCount; fx++) {
            const chain: any = { slot: fx };

            // FX type and params
            chain.type = await this.safeRead(`/fx/${fx}/type`);
            chain.params = [];
            for (let p = 1; p <= 16; p++) {
                const val = await this.safeRead(`/fx/${fx}/par/${p.toString().padStart(2, "0")}`);
                if (val !== null) chain.params.push({ param: p, value: val });
            }

            // Source assignment
            if (fx <= 4) {
                chain.sourceL = await this.safeRead(`/fx/${fx}/source/l`);
                chain.sourceR = await this.safeRead(`/fx/${fx}/source/r`);
            } else {
                chain.source = await this.safeRead(`/fx/${fx}/source`);
            }

            // FX return state
            const fxrPath = `/fxrtn/${fx.toString().padStart(2, "0")}`;
            chain.returnFader = await this.safeRead(`${fxrPath}/mix/fader`);
            chain.returnOn = (await this.safeRead(`${fxrPath}/mix/on`)) === 1;
            chain.returnName = await this.safeRead(`${fxrPath}/config/name`);

            chains.push(chain);
        }
        return chains;
    }

    async getAllEffects(): Promise<any[]> {
        const effects: any[] = [];
        for (let fx = 1; fx <= this.fxCount; fx++) {
            const slot: any = { slot: fx };
            if (this.protocol === "OSCXR") {
                try {
                    const val = await this.getEffectParam(fx, 1);
                    slot.params = [{ param: 1, value: val }];
                } catch {
                    slot.params = [{ param: 1, value: null }];
                }
                slot.unsupportedFields = ["type", "params2To16"];
                effects.push(slot);
                continue;
            }
            try { slot.type = await this.getEffectType(fx); } catch { slot.type = null; }
            slot.params = [];
            for (let p = 1; p <= 8; p++) {
                try {
                    const val = await this.getEffectParam(fx, p);
                    slot.params.push({ param: p, value: val });
                } catch {
                    slot.params.push({ param: p, value: null });
                }
            }
            effects.push(slot);
        }
        return effects;
    }

    // ========== Custom Commands ==========

    /**
     * Send a raw OSC command. Supports two modes:
     *  - Write:  pass `value` (and optionally `osctype` = 'int'|'float'|'string'|'bool').
     *            If `osctype` is omitted, type is inferred from the JS value
     *            (integer numbers → int, decimals → float, strings → string, booleans → T/F).
     *            Pass an array of { type, value } to send multiple typed args.
     *  - Read:   omit `value` entirely — sends a query and returns the mixer's reply value (or null on timeout).
     *
     * X32 is strict about OSC type tags: `/config/color` requires int (',i') — sending string '6' is silently dropped.
     * Use `osctype: 'int'` when LLMs may pass values as strings.
     */
    async sendCustomCommand(
        address: string,
        value?: any,
        osctype?: "int" | "float" | "string" | "bool",
    ): Promise<any> {
        // Read mode
        if (value === undefined) {
            try {
                return await this.sendAndReceive(address);
            } catch {
                return null;
            }
        }

        // Typed multi-arg: value is an array of { type, value } entries
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null && "type" in value[0]) {
            const packed = value.map((entry: any) => coerceOscArg(entry.value, entry.type));
            await this.sendCommand(address, packed);
            return;
        }

        // Single value, optional explicit type
        const args = Array.isArray(value) ? value : [value];
        const packed = args.map((v: any) => coerceOscArg(v, osctype));
        await this.sendCommand(address, packed);
    }

    close(): void {
        this.isConnected = false;
        this.osc.close();
    }
}
