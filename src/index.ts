#!/usr/bin/env node

import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { OSCClient, OSCProtocol } from "./osc-client.js";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default OSC configuration
const OSC_HOST = process.env.OSC_HOST || "192.168.1.17";
const OSC_PORT = parseInt(process.env.OSC_PORT || "10023");
const OSC_PROTOCOL = parseOscProtocol(process.env.OSC_PROTOCOL);

// Initialize OSC client
const osc = new OSCClient(OSC_HOST, OSC_PORT, OSC_PROTOCOL);

function parseOscProtocol(value?: string): OSCProtocol {
    if (!value) return "OSCX32M32";
    if (value === "OSCX32M32" || value === "OSCXR") return value;
    throw new Error(`Invalid OSC_PROTOCOL "${value}". Expected "OSCX32M32" or "OSCXR".`);
}

// Emulator process management
let emulatorProcess: ReturnType<typeof spawn> | null = null;
let emulatorPid: number | null = null;

// Define available tools
const TOOLS: Tool[] = [
    // ========== Channel Controls ==========
    {
        name: "osc_set_fader",
        description: "Set the fader level for a channel (0.0 to 1.0)",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                level: {
                    type: "number",
                    description: "Fader level (0.0 = -∞dB, 0.75 = 0dB, 1.0 = +10dB)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["channel", "level"],
        },
    },
    {
        name: "osc_get_fader",
        description: "Get the current fader level for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_mute_channel",
        description: "Mute or unmute a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["channel", "mute"],
        },
    },
    {
        name: "osc_get_mute",
        description: "Get the mute status of a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_set_pan",
        description: "Set the pan position for a channel (-1.0 = left, 0.0 = center, 1.0 = right)",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                pan: {
                    type: "number",
                    description: "Pan position (-1.0 to 1.0)",
                    minimum: -1,
                    maximum: 1,
                },
            },
            required: ["channel", "pan"],
        },
    },
    {
        name: "osc_get_pan",
        description: "Get the pan position for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_set_channel_name",
        description: "Set the name of a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                name: {
                    type: "string",
                    description: "Channel name (X32 accepts up to 12 characters; longer names get silently truncated by the console)",
                },
            },
            required: ["channel", "name"],
        },
    },
    {
        name: "osc_get_channel_name",
        description: "Get the name of a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    // ========== EQ Controls ==========
    {
        name: "osc_set_eq",
        description: "Set EQ gain for a channel band",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                band: {
                    type: "number",
                    description: "EQ band (1-4)",
                    minimum: 1,
                    maximum: 4,
                },
                gain: {
                    type: "number",
                    description: "Gain in dB (-15 to +15)",
                    minimum: -15,
                    maximum: 15,
                },
            },
            required: ["channel", "band", "gain"],
        },
    },
    {
        name: "osc_get_eq",
        description: "Get EQ gain for a channel band",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                band: {
                    type: "number",
                    description: "EQ band (1-4)",
                    minimum: 1,
                    maximum: 4,
                },
            },
            required: ["channel", "band"],
        },
    },
    {
        name: "osc_get_eq_frequency",
        description: "Get EQ frequency for a channel band (returns raw 0-1 value)",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                band: {
                    type: "number",
                    description: "EQ band (1-4)",
                    minimum: 1,
                    maximum: 4,
                },
            },
            required: ["channel", "band"],
        },
    },
    {
        name: "osc_get_eq_q",
        description: "Get EQ Q factor for a channel band (returns raw 0-1 value)",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                band: {
                    type: "number",
                    description: "EQ band (1-4)",
                    minimum: 1,
                    maximum: 4,
                },
            },
            required: ["channel", "band"],
        },
    },
    {
        name: "osc_get_eq_type",
        description: "Get EQ type for a channel band (returns raw value: 0=LCut, 1=LShv, 2=PEQ, 3=VEQ, 4=HShv, 5=HCut)",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                band: {
                    type: "number",
                    description: "EQ band (1-4)",
                    minimum: 1,
                    maximum: 4,
                },
            },
            required: ["channel", "band"],
        },
    },
    {
        name: "osc_get_eq_on",
        description: "Get whether EQ is enabled for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_copy_eq",
        description: "Copy all EQ settings (gain, frequency, Q, type, on/off) from one channel to another",
        inputSchema: {
            type: "object",
            properties: {
                source_channel: {
                    type: "number",
                    description: "Source channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                target_channel: {
                    type: "number",
                    description: "Target channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["source_channel", "target_channel"],
        },
    },
    {
        name: "osc_set_eq_frequency",
        description: "Set EQ frequency for a channel band",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                band: {
                    type: "number",
                    description: "EQ band (1-4)",
                    minimum: 1,
                    maximum: 4,
                },
                frequency: {
                    type: "number",
                    description: "Frequency in Hz",
                    minimum: 20,
                    maximum: 20000,
                },
            },
            required: ["channel", "band", "frequency"],
        },
    },
    {
        name: "osc_set_eq_q",
        description: "Set EQ Q factor for a channel band",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                band: {
                    type: "number",
                    description: "EQ band (1-4)",
                    minimum: 1,
                    maximum: 4,
                },
                q: {
                    type: "number",
                    description: "Q factor (0.1 to 10.0)",
                    minimum: 0.1,
                    maximum: 10,
                },
            },
            required: ["channel", "band", "q"],
        },
    },
    {
        name: "osc_set_eq_on",
        description: "Enable or disable EQ for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                on: {
                    type: "boolean",
                    description: "True to enable, false to disable",
                },
            },
            required: ["channel", "on"],
        },
    },
    // ========== Dynamics Controls ==========
    {
        name: "osc_set_gate",
        description: "Set gate threshold for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                threshold: {
                    type: "number",
                    description: "Gate threshold in dB (-80 to 0)",
                    minimum: -80,
                    maximum: 0,
                },
            },
            required: ["channel", "threshold"],
        },
    },
    {
        name: "osc_get_gate",
        description: "Get gate threshold for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_set_gate_on",
        description: "Enable or disable gate for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                on: {
                    type: "boolean",
                    description: "True to enable, false to disable",
                },
            },
            required: ["channel", "on"],
        },
    },
    {
        name: "osc_set_compressor",
        description: "Set compressor threshold and ratio for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                threshold: {
                    type: "number",
                    description: "Compressor threshold in dB (-60 to 0)",
                    minimum: -60,
                    maximum: 0,
                },
                ratio: {
                    type: "number",
                    description: "Compression ratio (1.0 to 20.0)",
                    minimum: 1,
                    maximum: 20,
                },
            },
            required: ["channel", "threshold", "ratio"],
        },
    },
    {
        name: "osc_set_compressor_attack",
        description: "Set compressor attack time for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                attack: {
                    type: "number",
                    description: "Attack time (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["channel", "attack"],
        },
    },
    {
        name: "osc_set_compressor_release",
        description: "Set compressor release time for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                release: {
                    type: "number",
                    description: "Release time (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["channel", "release"],
        },
    },
    {
        name: "osc_set_compressor_on",
        description: "Enable or disable compressor for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                on: {
                    type: "boolean",
                    description: "True to enable, false to disable",
                },
            },
            required: ["channel", "on"],
        },
    },
    // ========== Bus Controls ==========
    {
        name: "osc_set_bus_fader",
        description: "Set the fader level for a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                level: {
                    type: "number",
                    description: "Fader level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["bus", "level"],
        },
    },
    {
        name: "osc_get_bus_fader",
        description: "Get the fader level for a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
            },
            required: ["bus"],
        },
    },
    {
        name: "osc_mute_bus",
        description: "Mute or unmute a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["bus", "mute"],
        },
    },
    {
        name: "osc_set_bus_pan",
        description: "Set the pan position for a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                pan: {
                    type: "number",
                    description: "Pan position (-1.0 to 1.0)",
                    minimum: -1,
                    maximum: 1,
                },
            },
            required: ["bus", "pan"],
        },
    },
    {
        name: "osc_set_bus_name",
        description: "Set the name of a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                name: {
                    type: "string",
                    description: "Bus name (max 6 characters)",
                },
            },
            required: ["bus", "name"],
        },
    },
    // ========== Aux Controls ==========
    {
        name: "osc_set_aux_fader",
        description: "Set the fader level for an aux output",
        inputSchema: {
            type: "object",
            properties: {
                aux: {
                    type: "number",
                    description: "Aux number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                level: {
                    type: "number",
                    description: "Fader level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["aux", "level"],
        },
    },
    {
        name: "osc_get_aux_fader",
        description: "Get the fader level for an aux output",
        inputSchema: {
            type: "object",
            properties: {
                aux: {
                    type: "number",
                    description: "Aux number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
            },
            required: ["aux"],
        },
    },
    {
        name: "osc_mute_aux",
        description: "Mute or unmute an aux output",
        inputSchema: {
            type: "object",
            properties: {
                aux: {
                    type: "number",
                    description: "Aux number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["aux", "mute"],
        },
    },
    {
        name: "osc_set_aux_pan",
        description: "Set the pan position for an aux output",
        inputSchema: {
            type: "object",
            properties: {
                aux: {
                    type: "number",
                    description: "Aux number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                pan: {
                    type: "number",
                    description: "Pan position (-1.0 to 1.0)",
                    minimum: -1,
                    maximum: 1,
                },
            },
            required: ["aux", "pan"],
        },
    },
    // ========== Sends ==========
    {
        name: "osc_send_to_bus",
        description: "Set the send level from a channel to a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                bus: {
                    type: "number",
                    description: "Mix bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                level: {
                    type: "number",
                    description: "Send level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["channel", "bus", "level"],
        },
    },
    {
        name: "osc_get_send_to_bus",
        description: "Get the send level from a channel to a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                bus: {
                    type: "number",
                    description: "Mix bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
            },
            required: ["channel", "bus"],
        },
    },
    {
        name: "osc_send_to_aux",
        description: "Set the send level from a channel to an aux output",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                aux: {
                    type: "number",
                    description: "Aux number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                level: {
                    type: "number",
                    description: "Send level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["channel", "aux", "level"],
        },
    },
    // ========== Main Mix ==========
    {
        name: "osc_set_main_fader",
        description: "Set the main LR fader level",
        inputSchema: {
            type: "object",
            properties: {
                level: {
                    type: "number",
                    description: "Fader level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["level"],
        },
    },
    {
        name: "osc_get_main_fader",
        description: "Get the main LR fader level",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_mute_main",
        description: "Mute or unmute the main LR mix",
        inputSchema: {
            type: "object",
            properties: {
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["mute"],
        },
    },
    {
        name: "osc_set_main_pan",
        description: "Set the pan position for the main LR mix",
        inputSchema: {
            type: "object",
            properties: {
                pan: {
                    type: "number",
                    description: "Pan position (-1.0 to 1.0)",
                    minimum: -1,
                    maximum: 1,
                },
            },
            required: ["pan"],
        },
    },
    // ========== Matrix ==========
    {
        name: "osc_set_matrix_fader",
        description: "Set the fader level for a matrix output",
        inputSchema: {
            type: "object",
            properties: {
                matrix: {
                    type: "number",
                    description: "Matrix number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                level: {
                    type: "number",
                    description: "Fader level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["matrix", "level"],
        },
    },
    {
        name: "osc_mute_matrix",
        description: "Mute or unmute a matrix output",
        inputSchema: {
            type: "object",
            properties: {
                matrix: {
                    type: "number",
                    description: "Matrix number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["matrix", "mute"],
        },
    },
    // ========== Effects ==========
    {
        name: "osc_get_effect_type",
        description: "Get the effect type/algorithm loaded in an FX slot",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
            },
            required: ["effect"],
        },
    },
    {
        name: "osc_get_effect_on",
        description: "Get whether an FX return channel is unmuted (X32 FX slots are always instantiated; this checks the FX return mute state)",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
            },
            required: ["effect"],
        },
    },
    {
        name: "osc_get_effect_param",
        description: "Get a parameter value for an effect",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
                param: {
                    type: "number",
                    description: "Parameter number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
            },
            required: ["effect", "param"],
        },
    },
    {
        name: "osc_get_all_effects",
        description: "Get a summary of all 8 FX slots including type and first 8 parameters",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_channel_strip",
        description: "Get full channel strip: name, fader, mute, pan, headamp (gain/phantom), EQ (all 4 bands with gain/freq/Q/type), gate (full params), compressor (full params), and all 16 bus sends (level/pan/pre-post)",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_get_bus_strip",
        description: "Get full mix bus strip: name, fader, mute, pan, EQ, dynamics",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
            },
            required: ["bus"],
        },
    },
    {
        name: "osc_get_aux_strip",
        description: "Get aux input strip: name, fader, mute, pan, source",
        inputSchema: {
            type: "object",
            properties: {
                aux: {
                    type: "number",
                    description: "Aux input number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
            },
            required: ["aux"],
        },
    },
    {
        name: "osc_get_fxreturn_strip",
        description: "Get FX return strip: name, fader, mute, pan",
        inputSchema: {
            type: "object",
            properties: {
                fxreturn: {
                    type: "number",
                    description: "FX return number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
            },
            required: ["fxreturn"],
        },
    },
    {
        name: "osc_get_matrix_strip",
        description: "Get matrix output strip: name, fader, mute, pan, EQ",
        inputSchema: {
            type: "object",
            properties: {
                matrix: {
                    type: "number",
                    description: "Matrix number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
            },
            required: ["matrix"],
        },
    },
    {
        name: "osc_get_dca",
        description: "Get DCA group: name, fader, mute",
        inputSchema: {
            type: "object",
            properties: {
                dca: {
                    type: "number",
                    description: "DCA group number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
            },
            required: ["dca"],
        },
    },
    {
        name: "osc_get_main_strip",
        description: "Get main stereo bus: fader, mute, pan, 6-band EQ, dynamics, plus mono bus status",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_headamp",
        description: "Get headamp/preamp settings: gain and phantom power for a given headamp index (0-63 for local, 64-127 for AES50-A, 128-191 for AES50-B)",
        inputSchema: {
            type: "object",
            properties: {
                index: {
                    type: "number",
                    description: "Headamp index (0-191)",
                    minimum: 0,
                    maximum: 191,
                },
            },
            required: ["index"],
        },
    },
    {
        name: "osc_get_console_overview",
        description: "Get a high-level overview of the ENTIRE console: all 32 channels (name/fader/mute), 16 buses, 8 DCAs, 6 matrices, 8 aux inputs, 8 FX returns, 8 FX slot types, and main bus. Warning: this reads ~200 parameters so takes several seconds.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_routing",
        description: "Get full console routing: FX source assignments (which bus feeds which FX), input routing blocks, output routing blocks, AES50 routing, and card routing",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_user_routing",
        description: "Get the user-defined routing tables (firmware 4.0+): 32 User In slot assignments and 48 User Out slot assignments. These determine the per-channel source when a routing block is set to USER IN/OUT.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_user_routing_in",
        description: "Get a single User In routing slot assignment (1-32)",
        inputSchema: {
            type: "object",
            properties: {
                slot: { type: "number", description: "User In slot (1-32)", minimum: 1, maximum: 32 },
            },
            required: ["slot"],
        },
    },
    {
        name: "osc_set_user_routing_in",
        description: "Per-channel 1:1 input routing (firmware 4.0+). Each of the 32 channel slots can be independently assigned to ANY physical source (Local, AES50A/B, Card, AuxIn) — this replaces the old 8-channel block constraint and is the modern way to build scenes. Requires the corresponding input routing block (/config/routing/IN/N-M) to be set to 'User In' (block enum values 20-23) for the patch to take effect.\n\nSource accepts a label string: 'Card 1', 'Local 27', 'AES50A 5', 'AES50B 12', 'AUX In 3', 'OFF'. Or raw int: 0=OFF, 1-32=Local 1-32, 33-80=AES50A 1-48, 81-128=AES50B 1-48, 129-160=Card 1-32, 161-168=AUX In 1-8.",
        inputSchema: {
            type: "object",
            properties: {
                slot: { type: "number", description: "User In slot (1-32)", minimum: 1, maximum: 32 },
                source: { type: ["number", "string"], description: "Source label (e.g. 'Card 1') or raw int (0-168)" },
            },
            required: ["slot", "source"],
        },
    },
    {
        name: "osc_get_routing_overview",
        description: "RECOMMENDED FIRST CALL for any routing work. Returns the full X32 routing topology in one shot: input/output/AES50/Card block assignments (which 8-ch source group feeds each range) PLUS the 32-slot User In table PLUS the 48-slot User Out table, all decoded to human labels. Shows whether each channel range uses legacy 8-ch block routing or firmware-4.0+ per-slot User In (1:1 patching). If inputBlocks shows 'User In 25-32', the per-channel sources for channels 25-32 live in userIn[24..31].",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "osc_get_channel_color",
        description: "Get channel strip color (0-15)",
        inputSchema: { type: "object", properties: { channel: { type: "number", minimum: 1, maximum: 32 } }, required: ["channel"] },
    },
    {
        name: "osc_get_channel_icon",
        description: "Get channel strip icon index",
        inputSchema: { type: "object", properties: { channel: { type: "number", minimum: 1, maximum: 32 } }, required: ["channel"] },
    },
    {
        name: "osc_set_channel_icon",
        description: "Set channel strip icon (int enum, 1-74 approximately; see X32 icon list)",
        inputSchema: { type: "object", properties: { channel: { type: "number", minimum: 1, maximum: 32 }, icon: { type: "number" } }, required: ["channel", "icon"] },
    },
    {
        name: "osc_get_channel_links",
        description: "Get stereo-link state for each channel pair (1-2, 3-4, ..., 31-32). Returns 16 per-pair booleans.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "osc_set_channel_link",
        description: "Link or unlink a channel pair for stereo operation. Pair format: '1-2', '3-4', ..., '31-32'.",
        inputSchema: { type: "object", properties: { pair: { type: "string" }, linked: { type: "boolean" } }, required: ["pair", "linked"] },
    },
    {
        name: "osc_get_bus_links",
        description: "Get stereo-link state for each bus pair (1-2, 3-4, ..., 15-16).",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "osc_set_bus_link",
        description: "Link or unlink a bus pair for stereo operation. Pair format: '1-2', '3-4', ..., '15-16'.",
        inputSchema: { type: "object", properties: { pair: { type: "string" }, linked: { type: "boolean" } }, required: ["pair", "linked"] },
    },
    {
        name: "osc_list_routing_sources",
        description: "Reference dump: lists every valid User In source label and its numeric code, plus the block-level routing enum. Use this when you need to know what values to pass to set_user_routing_in or to interpret raw codes from get_routing.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "osc_get_user_routing_out",
        description: "Get a single User Out routing slot assignment (1-48)",
        inputSchema: {
            type: "object",
            properties: {
                slot: { type: "number", description: "User Out slot (1-48)", minimum: 1, maximum: 48 },
            },
            required: ["slot"],
        },
    },
    {
        name: "osc_set_user_routing_out",
        description: "Set a single User Out routing slot's source (1-48). Source value is an integer representing the signal source per X32 OSC spec.",
        inputSchema: {
            type: "object",
            properties: {
                slot: { type: "number", description: "User Out slot (1-48)", minimum: 1, maximum: 48 },
                source: { type: "number", description: "Source index (see X32 OSC spec for values)", minimum: 0 },
            },
            required: ["slot", "source"],
        },
    },
    {
        name: "osc_get_full_fx_chain",
        description: "Get the complete FX signal chain: for each of the 8 FX slots, returns the FX type, all 16 parameters, source assignment (which bus feeds it), and the FX return channel state (fader/mute/name). This is the full picture of what effects are loaded, how they're configured, what feeds them, and whether the return is active.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_set_effect_on",
        description: "Mute/unmute an FX return channel (X32 FX are always instantiated; this controls the FX return mute)",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
                on: {
                    type: "boolean",
                    description: "True to enable, false to disable",
                },
            },
            required: ["effect", "on"],
        },
    },
    {
        name: "osc_set_effect_param",
        description: "Set a parameter value for an effect",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
                param: {
                    type: "number",
                    description: "Parameter number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                value: {
                    type: "number",
                    description: "Parameter value (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["effect", "param", "value"],
        },
    },
    // ========== Routing ==========
    {
        name: "osc_set_channel_source",
        description: "Set the channel-strip input tap (/ch/NN/config/source). Value selects a tap WITHIN whatever source group is currently feeding this channel's 8-ch routing block — NOT a direct physical input picker. Source map: 0=OFF, 1-32=Input N (routed via the active block), 33-40=AUX/USB in, 41-48=FX return L/R. \n\nIMPORTANT: For per-channel 1:1 physical input mapping (firmware 4.0+), this is usually NOT the right tool. Instead: (a) set the input routing block to 'User In' with osc_custom_command /config/routing/IN/N-M as int, and (b) use osc_set_user_routing_in to patch each of the 32 User In slots to any physical source (Local/AES50A/AES50B/Card/AuxIn). Call osc_get_routing_overview first to see the current topology.",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                source: {
                    type: "number",
                    description: "Source number (0-63)",
                    minimum: 0,
                    maximum: 63,
                },
            },
            required: ["channel", "source"],
        },
    },
    {
        name: "osc_get_channel_source",
        description: "Get the input source for a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    // ========== Scenes ==========
    {
        name: "osc_scene_recall",
        description: "Recall a saved scene",
        inputSchema: {
            type: "object",
            properties: {
                scene: {
                    type: "number",
                    description: "Scene number (1-100)",
                    minimum: 1,
                    maximum: 100,
                },
            },
            required: ["scene"],
        },
    },
    {
        name: "osc_scene_save",
        description: "Save the current mixer state as a scene",
        inputSchema: {
            type: "object",
            properties: {
                scene: {
                    type: "number",
                    description: "Scene number (1-100)",
                    minimum: 1,
                    maximum: 100,
                },
                name: {
                    type: "string",
                    description: "Scene name (optional)",
                },
            },
            required: ["scene"],
        },
    },
    {
        name: "osc_get_scene_name",
        description: "Get the name of a saved scene",
        inputSchema: {
            type: "object",
            properties: {
                scene: {
                    type: "number",
                    description: "Scene number (1-100)",
                    minimum: 1,
                    maximum: 100,
                },
            },
            required: ["scene"],
        },
    },
    // ========== Status ==========
    {
        name: "osc_get_mixer_status",
        description: "Get overall mixer status and information",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    // ========== Custom Commands ==========
    {
        name: "osc_custom_command",
        description: "Send a raw OSC command. TWO modes:\n  (1) WRITE: pass 'value'. Include 'osctype' ('int'|'float'|'string'|'bool') when the address requires a specific OSC type tag — X32 silently drops type mismatches (e.g., /ch/NN/config/color REQUIRES int; passing '6' as string fails silently). For multiple args, pass value as an array of {type, value} objects.\n  (2) READ: omit 'value' — the tool sends a query and returns the mixer's reply (or null on timeout). Use this to verify writes or to read addresses that have no dedicated getter.\n\nCommon X32 addresses that REQUIRE osctype='int': /ch/NN/config/color, /ch/NN/config/icon, /config/chlink, /config/buslink, /config/mute/N, /-stat/solosw/NN, scene recall indices.",
        inputSchema: {
            type: "object",
            properties: {
                address: {
                    type: "string",
                    description: "OSC address (e.g., /ch/01/mix/fader)",
                },
                value: {
                    description: "Value to send. Omit to READ the address and get the mixer's reply. Can be a scalar (number/string/bool) or an array of {type, value} objects for multi-arg messages.",
                },
                osctype: {
                    type: "string",
                    enum: ["int", "float", "string", "bool"],
                    description: "Force the OSC type tag for 'value'. Use 'int' for color/icon/chlink/mute-group/solosw/scene addresses. When omitted, type is inferred from JSON type.",
                },
            },
            required: ["address"],
        },
    },
    // ========== Application Controls ==========
    {
        name: "osc_open_x32_edit",
        description:
            "Open the X32-Edit application to manually control the mixer or verify commands",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_start_emulator",
        description:
            "Start the local X32 emulator server from the emulator/X32 binary so you can test without a physical mixer",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_stop_emulator",
        description: "Stop the running X32 emulator server",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_emulator_status",
        description: "Check if the X32 emulator is currently running",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
];

// Create MCP server
const server = new Server(
    {
        name: "osc-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            // ========== Channel Controls ==========
            case "osc_set_fader": {
                const { channel, level } = args as { channel: number; level: number };
                await osc.setFader(channel, level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} fader to ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_get_fader": {
                const { channel } = args as { channel: number };
                const level = await osc.getFader(channel);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} fader is at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_mute_channel": {
                const { channel, mute } = args as { channel: number; mute: boolean };
                await osc.muteChannel(channel, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_get_mute": {
                const { channel } = args as { channel: number };
                const mute = await osc.getMute(channel);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} is ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_set_pan": {
                const { channel, pan } = args as { channel: number; pan: number };
                await osc.setPan(channel, pan);
                const panText =
                    pan < -0.1 ? "left" : pan > 0.1 ? "right" : "center";
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} pan to ${panText} (${pan.toFixed(2)})`,
                        },
                    ],
                };
            }

            case "osc_get_pan": {
                const { channel } = args as { channel: number };
                const pan = await osc.getPan(channel);
                const panText =
                    pan < -0.1 ? "left" : pan > 0.1 ? "right" : "center";
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} pan is ${panText} (${pan.toFixed(2)})`,
                        },
                    ],
                };
            }

            case "osc_set_channel_name": {
                const { channel, name } = args as { channel: number; name: string };
                await osc.setChannelName(channel, name);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} name to "${name}"`,
                        },
                    ],
                };
            }

            case "osc_get_channel_name": {
                const { channel } = args as { channel: number };
                const name = await osc.getChannelName(channel);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} name is "${name}"`,
                        },
                    ],
                };
            }

            // ========== EQ Controls ==========
            case "osc_set_eq": {
                const { channel, band, gain } = args as {
                    channel: number;
                    band: number;
                    gain: number;
                };
                await osc.setEQ(channel, band, gain);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} EQ band ${band} to ${gain > 0 ? "+" : ""}${gain}dB`,
                        },
                    ],
                };
            }

            case "osc_get_eq": {
                const { channel, band } = args as { channel: number; band: number };
                const gain = await osc.getEQ(channel, band);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} EQ band ${band} is at ${gain > 0 ? "+" : ""}${gain.toFixed(1)}dB`,
                        },
                    ],
                };
            }

            case "osc_get_eq_frequency": {
                const { channel, band } = args as { channel: number; band: number };
                const freq = await osc.getEQFrequency(channel, band);
                return {
                    content: [{ type: "text", text: `Channel ${channel} EQ band ${band} frequency: ${freq}` }],
                };
            }

            case "osc_get_eq_q": {
                const { channel, band } = args as { channel: number; band: number };
                const qVal = await osc.getEQQ(channel, band);
                return {
                    content: [{ type: "text", text: `Channel ${channel} EQ band ${band} Q: ${qVal}` }],
                };
            }

            case "osc_get_eq_type": {
                const { channel, band } = args as { channel: number; band: number };
                const eqType = await osc.getEQType(channel, band);
                const typeNames = ["LCut", "LShv", "PEQ", "VEQ", "HShv", "HCut"];
                return {
                    content: [{ type: "text", text: `Channel ${channel} EQ band ${band} type: ${eqType} (${typeNames[eqType] || "unknown"})` }],
                };
            }

            case "osc_get_eq_on": {
                const { channel } = args as { channel: number };
                const eqOn = await osc.getEQOn(channel);
                return {
                    content: [{ type: "text", text: `Channel ${channel} EQ is ${eqOn ? "enabled" : "disabled"}` }],
                };
            }

            case "osc_copy_eq": {
                const { source_channel, target_channel } = args as { source_channel: number; target_channel: number };
                const results: string[] = [];

                // Copy EQ on/off state
                const eqOn = await osc.getEQOn(source_channel);
                await osc.setEQOn(target_channel, eqOn);
                results.push(`EQ enabled: ${eqOn}`);

                // Copy all 4 bands
                for (let band = 1; band <= 4; band++) {
                    const gain = await osc.getEQ(source_channel, band);
                    const freq = await osc.getEQFrequency(source_channel, band);
                    const q = await osc.getEQQ(source_channel, band);
                    const type = await osc.getEQType(source_channel, band);

                    await osc.setEQ(target_channel, band, gain);
                    await osc.setEQFrequency(target_channel, band, freq);
                    await osc.setEQQ(target_channel, band, q);
                    await osc.setEQType(target_channel, band, type);

                    results.push(`Band ${band}: gain=${gain.toFixed(1)}dB, freq=${freq}, Q=${q}, type=${type}`);
                }

                return {
                    content: [{ type: "text", text: `Copied EQ from channel ${source_channel} to channel ${target_channel}:\n${results.join("\n")}` }],
                };
            }

            case "osc_set_eq_frequency": {
                const { channel, band, frequency } = args as {
                    channel: number;
                    band: number;
                    frequency: number;
                };
                await osc.setEQFrequency(channel, band, frequency);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} EQ band ${band} frequency to ${frequency}Hz`,
                        },
                    ],
                };
            }

            case "osc_set_eq_q": {
                const { channel, band, q } = args as {
                    channel: number;
                    band: number;
                    q: number;
                };
                await osc.setEQQ(channel, band, q);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} EQ band ${band} Q to ${q.toFixed(2)}`,
                        },
                    ],
                };
            }

            case "osc_set_eq_on": {
                const { channel, on } = args as { channel: number; on: boolean };
                await osc.setEQOn(channel, on);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} EQ ${on ? "enabled" : "disabled"}`,
                        },
                    ],
                };
            }

            // ========== Dynamics Controls ==========
            case "osc_set_gate": {
                const { channel, threshold } = args as {
                    channel: number;
                    threshold: number;
                };
                await osc.setGate(channel, threshold);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} gate threshold to ${threshold}dB`,
                        },
                    ],
                };
            }

            case "osc_get_gate": {
                const { channel } = args as { channel: number };
                const threshold = await osc.getGate(channel);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} gate threshold is ${threshold.toFixed(1)}dB`,
                        },
                    ],
                };
            }

            case "osc_set_gate_on": {
                const { channel, on } = args as { channel: number; on: boolean };
                await osc.setGateOn(channel, on);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} gate ${on ? "enabled" : "disabled"}`,
                        },
                    ],
                };
            }

            case "osc_set_compressor": {
                const { channel, threshold, ratio } = args as {
                    channel: number;
                    threshold: number;
                    ratio: number;
                };
                await osc.setCompressor(channel, threshold, ratio);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} compressor: ${threshold}dB threshold, ${ratio}:1 ratio`,
                        },
                    ],
                };
            }

            case "osc_set_compressor_attack": {
                const { channel, attack } = args as {
                    channel: number;
                    attack: number;
                };
                await osc.setCompressorAttack(channel, attack);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} compressor attack to ${(attack * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_set_compressor_release": {
                const { channel, release } = args as {
                    channel: number;
                    release: number;
                };
                await osc.setCompressorRelease(channel, release);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} compressor release to ${(release * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_set_compressor_on": {
                const { channel, on } = args as { channel: number; on: boolean };
                await osc.setCompressorOn(channel, on);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} compressor ${on ? "enabled" : "disabled"}`,
                        },
                    ],
                };
            }

            // ========== Bus Controls ==========
            case "osc_set_bus_fader": {
                const { bus, level } = args as { bus: number; level: number };
                await osc.setBusFader(bus, level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set bus ${bus} fader to ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_get_bus_fader": {
                const { bus } = args as { bus: number };
                const level = await osc.getBusFader(bus);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Bus ${bus} fader is at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_mute_bus": {
                const { bus, mute } = args as { bus: number; mute: boolean };
                await osc.muteBus(bus, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Bus ${bus} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_set_bus_pan": {
                const { bus, pan } = args as { bus: number; pan: number };
                await osc.setBusPan(bus, pan);
                const panText =
                    pan < -0.1 ? "left" : pan > 0.1 ? "right" : "center";
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set bus ${bus} pan to ${panText} (${pan.toFixed(2)})`,
                        },
                    ],
                };
            }

            case "osc_set_bus_name": {
                const { bus, name } = args as { bus: number; name: string };
                await osc.setBusName(bus, name);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set bus ${bus} name to "${name}"`,
                        },
                    ],
                };
            }

            // ========== Aux Controls ==========
            case "osc_set_aux_fader": {
                const { aux, level } = args as { aux: number; level: number };
                await osc.setAuxFader(aux, level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set aux ${aux} fader to ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_get_aux_fader": {
                const { aux } = args as { aux: number };
                const level = await osc.getAuxFader(aux);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Aux ${aux} fader is at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_mute_aux": {
                const { aux, mute } = args as { aux: number; mute: boolean };
                await osc.muteAux(aux, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Aux ${aux} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_set_aux_pan": {
                const { aux, pan } = args as { aux: number; pan: number };
                await osc.setAuxPan(aux, pan);
                const panText =
                    pan < -0.1 ? "left" : pan > 0.1 ? "right" : "center";
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set aux ${aux} pan to ${panText} (${pan.toFixed(2)})`,
                        },
                    ],
                };
            }

            // ========== Sends ==========
            case "osc_send_to_bus": {
                const { channel, bus, level } = args as {
                    channel: number;
                    bus: number;
                    level: number;
                };
                await osc.sendToBus(channel, bus, level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} send to bus ${bus} at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_get_send_to_bus": {
                const { channel, bus } = args as {
                    channel: number;
                    bus: number;
                };
                const level = await osc.getSendToBus(channel, bus);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} send to bus ${bus} is at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_send_to_aux": {
                const { channel, aux, level } = args as {
                    channel: number;
                    aux: number;
                    level: number;
                };
                await osc.sendToAux(channel, aux, level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} send to aux ${aux} at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            // ========== Main Mix ==========
            case "osc_set_main_fader": {
                const { level } = args as { level: number };
                await osc.setMainFader(level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set main LR fader to ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_get_main_fader": {
                const level = await osc.getMainFader();
                return {
                    content: [
                        {
                            type: "text",
                            text: `Main LR fader is at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_mute_main": {
                const { mute } = args as { mute: boolean };
                await osc.muteMain(mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Main LR mix ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_set_main_pan": {
                const { pan } = args as { pan: number };
                await osc.setMainPan(pan);
                const panText =
                    pan < -0.1 ? "left" : pan > 0.1 ? "right" : "center";
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set main LR pan to ${panText} (${pan.toFixed(2)})`,
                        },
                    ],
                };
            }

            // ========== Matrix ==========
            case "osc_set_matrix_fader": {
                const { matrix, level } = args as {
                    matrix: number;
                    level: number;
                };
                await osc.setMatrixFader(matrix, level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set matrix ${matrix} fader to ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            case "osc_mute_matrix": {
                const { matrix, mute } = args as {
                    matrix: number;
                    mute: boolean;
                };
                await osc.muteMatrix(matrix, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Matrix ${matrix} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            // ========== Effects ==========
            case "osc_get_effect_type": {
                const { effect } = args as { effect: number };
                const fxType = await osc.getEffectType(effect);
                return {
                    content: [{ type: "text", text: `FX slot ${effect} type: ${fxType}` }],
                };
            }

            case "osc_get_effect_on": {
                const { effect } = args as { effect: number };
                const fxOn = await osc.getEffectOn(effect);
                return {
                    content: [{ type: "text", text: `FX slot ${effect} is ${fxOn ? "enabled" : "disabled"}` }],
                };
            }

            case "osc_get_effect_param": {
                const { effect, param } = args as { effect: number; param: number };
                const paramVal = await osc.getEffectParam(effect, param);
                return {
                    content: [{ type: "text", text: `FX slot ${effect} param ${param}: ${paramVal}` }],
                };
            }

            case "osc_get_all_effects": {
                const allFx = await osc.getAllEffects();
                return {
                    content: [{ type: "text", text: `All FX slots:\n${JSON.stringify(allFx, null, 2)}` }],
                };
            }

            case "osc_get_channel_strip": {
                const { channel } = args as { channel: number };
                const strip = await osc.getChannelStrip(channel);
                return {
                    content: [{ type: "text", text: `Channel ${channel} full strip:\n${JSON.stringify(strip, null, 2)}` }],
                };
            }

            case "osc_get_bus_strip": {
                const { bus } = args as { bus: number };
                const busStrip = await osc.getBusStrip(bus);
                return {
                    content: [{ type: "text", text: `Bus ${bus} strip:\n${JSON.stringify(busStrip, null, 2)}` }],
                };
            }

            case "osc_get_aux_strip": {
                const { aux } = args as { aux: number };
                const auxStrip = await osc.getAuxStrip(aux);
                return {
                    content: [{ type: "text", text: `Aux ${aux} strip:\n${JSON.stringify(auxStrip, null, 2)}` }],
                };
            }

            case "osc_get_fxreturn_strip": {
                const { fxreturn } = args as { fxreturn: number };
                const fxrStrip = await osc.getFxReturnStrip(fxreturn);
                return {
                    content: [{ type: "text", text: `FX Return ${fxreturn} strip:\n${JSON.stringify(fxrStrip, null, 2)}` }],
                };
            }

            case "osc_get_matrix_strip": {
                const { matrix } = args as { matrix: number };
                const mtxStrip = await osc.getMatrixStrip(matrix);
                return {
                    content: [{ type: "text", text: `Matrix ${matrix} strip:\n${JSON.stringify(mtxStrip, null, 2)}` }],
                };
            }

            case "osc_get_dca": {
                const { dca } = args as { dca: number };
                const dcaData = await osc.getDCA(dca);
                return {
                    content: [{ type: "text", text: `DCA ${dca}:\n${JSON.stringify(dcaData, null, 2)}` }],
                };
            }

            case "osc_get_main_strip": {
                const mainStrip = await osc.getMainStrip();
                return {
                    content: [{ type: "text", text: `Main bus:\n${JSON.stringify(mainStrip, null, 2)}` }],
                };
            }

            case "osc_get_headamp": {
                const { index } = args as { index: number };
                const ha = await osc.getHeadamp(index);
                return {
                    content: [{ type: "text", text: `Headamp ${index}:\n${JSON.stringify(ha, null, 2)}` }],
                };
            }

            case "osc_get_console_overview": {
                const overview = await osc.getConsoleOverview();
                return {
                    content: [{ type: "text", text: `Console overview:\n${JSON.stringify(overview, null, 2)}` }],
                };
            }

            case "osc_get_routing": {
                const routing = await osc.getRouting();
                return {
                    content: [{ type: "text", text: `Console routing:\n${JSON.stringify(routing, null, 2)}` }],
                };
            }

            case "osc_get_user_routing": {
                const userRouting = await osc.getUserRouting();
                return {
                    content: [{ type: "text", text: `User-defined routing:\n${JSON.stringify(userRouting, null, 2)}` }],
                };
            }

            case "osc_get_user_routing_in": {
                const { slot } = args as { slot: number };
                const src = await osc.getUserRoutingIn(slot);
                return {
                    content: [{ type: "text", text: `User In slot ${slot}: ${src.sourceLabel} (raw ${src.source})` }],
                };
            }

            case "osc_set_user_routing_in": {
                const { slot, source } = args as { slot: number; source: number | string };
                await osc.setUserRoutingIn(slot, source);
                return {
                    content: [{ type: "text", text: `Set User In slot ${slot} source to ${source}` }],
                };
            }

            case "osc_get_routing_overview": {
                const ov = await osc.getRoutingOverview();
                return { content: [{ type: "text", text: `Routing overview:\n${JSON.stringify(ov, null, 2)}` }] };
            }

            case "osc_get_channel_color": {
                const { channel } = args as { channel: number };
                const c = await osc.getChannelColor(channel);
                return { content: [{ type: "text", text: `Channel ${channel} color: ${c}` }] };
            }

            case "osc_get_channel_icon": {
                const { channel } = args as { channel: number };
                const i = await osc.getChannelIcon(channel);
                return { content: [{ type: "text", text: `Channel ${channel} icon: ${i}` }] };
            }

            case "osc_set_channel_icon": {
                const { channel, icon } = args as { channel: number; icon: number };
                await osc.setChannelIcon(channel, icon);
                return { content: [{ type: "text", text: `Set channel ${channel} icon to ${icon}` }] };
            }

            case "osc_get_channel_links": {
                const links = await osc.getChannelLinks();
                return { content: [{ type: "text", text: `Channel links:\n${JSON.stringify(links, null, 2)}` }] };
            }

            case "osc_set_channel_link": {
                const { pair, linked } = args as { pair: string; linked: boolean };
                await osc.setChannelLink(pair, linked);
                return { content: [{ type: "text", text: `Channel pair ${pair} ${linked ? "linked" : "unlinked"}` }] };
            }

            case "osc_get_bus_links": {
                const links = await osc.getBusLinks();
                return { content: [{ type: "text", text: `Bus links:\n${JSON.stringify(links, null, 2)}` }] };
            }

            case "osc_set_bus_link": {
                const { pair, linked } = args as { pair: string; linked: boolean };
                await osc.setBusLink(pair, linked);
                return { content: [{ type: "text", text: `Bus pair ${pair} ${linked ? "linked" : "unlinked"}` }] };
            }

            case "osc_list_routing_sources": {
                const userIn: Record<string, number> = { OFF: 0 };
                for (let i = 1; i <= 32; i++) userIn[`Local ${i}`] = i;
                for (let i = 1; i <= 48; i++) userIn[`AES50A ${i}`] = 32 + i;
                for (let i = 1; i <= 48; i++) userIn[`AES50B ${i}`] = 80 + i;
                for (let i = 1; i <= 32; i++) userIn[`Card ${i}`] = 128 + i;
                for (let i = 1; i <= 8; i++) userIn[`AUX In ${i}`] = 160 + i;
                const blockEnum: Record<number, string> = {};
                for (let n = 0; n <= 24; n++) blockEnum[n] = (await import("./osc-client.js")).decodeBlockInSource(n);
                return {
                    content: [{
                        type: "text",
                        text: `User In source codes (for /config/userrout/in/NN):\n${JSON.stringify(userIn, null, 2)}\n\nBlock-level routing enum (for /config/routing/IN, AES50A, AES50B, CARD blocks):\n${JSON.stringify(blockEnum, null, 2)}`,
                    }],
                };
            }

            case "osc_get_user_routing_out": {
                const { slot } = args as { slot: number };
                const src = await osc.getUserRoutingOut(slot);
                return {
                    content: [{ type: "text", text: `User Out slot ${slot}: ${src.sourceLabel} (raw ${src.source})` }],
                };
            }

            case "osc_set_user_routing_out": {
                const { slot, source } = args as { slot: number; source: number };
                await osc.setUserRoutingOut(slot, source);
                return {
                    content: [{ type: "text", text: `Set User Out slot ${slot} source to ${source}` }],
                };
            }

            case "osc_get_full_fx_chain": {
                const fxChain = await osc.getFullFxChain();
                return {
                    content: [{ type: "text", text: `Full FX chain:\n${JSON.stringify(fxChain, null, 2)}` }],
                };
            }

            case "osc_set_effect_on": {
                const { effect, on } = args as {
                    effect: number;
                    on: boolean;
                };
                await osc.setEffectOn(effect, on);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Effect ${effect} ${on ? "enabled" : "disabled"}`,
                        },
                    ],
                };
            }

            case "osc_set_effect_param": {
                const { effect, param, value } = args as {
                    effect: number;
                    param: number;
                    value: number;
                };
                await osc.setEffectParam(effect, param, value);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set effect ${effect} parameter ${param} to ${(value * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            // ========== Routing ==========
            case "osc_set_channel_source": {
                const { channel, source } = args as {
                    channel: number;
                    source: number;
                };
                await osc.setChannelSource(channel, source);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} source to ${source}`,
                        },
                    ],
                };
            }

            case "osc_get_channel_source": {
                const { channel } = args as { channel: number };
                const source = await osc.getChannelSource(channel);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} source is ${source}`,
                        },
                    ],
                };
            }

            // ========== Scenes ==========
            case "osc_scene_recall": {
                const { scene } = args as { scene: number };
                await osc.recallScene(scene);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Recalled scene ${scene}`,
                        },
                    ],
                };
            }

            case "osc_scene_save": {
                const { scene, name } = args as {
                    scene: number;
                    name?: string;
                };
                await osc.saveScene(scene, name);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Saved scene ${scene}${name ? ` as "${name}"` : ""}`,
                        },
                    ],
                };
            }

            case "osc_get_scene_name": {
                const { scene } = args as { scene: number };
                const name = await osc.getSceneName(scene);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Scene ${scene} name is "${name}"`,
                        },
                    ],
                };
            }

            // ========== Status ==========
            case "osc_get_mixer_status": {
                const status = await osc.getMixerStatus();
                return {
                    content: [
                        {
                            type: "text",
                            text: `Mixer Status:\n${JSON.stringify(status, null, 2)}`,
                        },
                    ],
                };
            }

            // ========== Custom Commands ==========
            case "osc_custom_command": {
                const { address, value, osctype } = args as {
                    address: string;
                    value?: any;
                    osctype?: "int" | "float" | "string" | "bool";
                };
                const result = await osc.sendCustomCommand(address, value, osctype);
                if (value === undefined) {
                    return {
                        content: [{ type: "text", text: `READ ${address} => ${JSON.stringify(result)}` }],
                    };
                }
                return {
                    content: [{ type: "text", text: `WROTE ${address} = ${JSON.stringify(value)}${osctype ? ` (forced ${osctype})` : ""}` }],
                };
            }

            // ========== Application Controls ==========
            case "osc_open_x32_edit": {
                try {
                    await execAsync("open /Applications/X32-Edit.app");
                    return {
                        content: [
                            {
                                type: "text",
                                text: "X32-Edit application opened successfully. You can now manually control the mixer or verify that commands were applied.",
                            },
                        ],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Failed to open X32-Edit: ${error instanceof Error ? error.message : String(error)}. Make sure X32-Edit.app is installed at /Applications/X32-Edit.app`,
                            },
                        ],
                        isError: true,
                    };
                }
            }

            case "osc_start_emulator": {
                try {
                    // Check if emulator is already running
                    if (emulatorPid !== null) {
                        try {
                            // Check if process is still alive (signal 0 doesn't kill, just checks)
                            process.kill(emulatorPid, 0);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `X32 emulator is already running (PID: ${emulatorPid}). No need to start it again.`,
                                    },
                                ],
                            };
                        } catch {
                            // Process doesn't exist, reset variables
                            emulatorProcess = null;
                            emulatorPid = null;
                        }
                    }

                    const emulatorPath = path.resolve(__dirname, "../emulator/X32");

                    const child = spawn(emulatorPath, [], {
                        detached: true,
                        stdio: "ignore",
                    });

                    emulatorProcess = child;
                    emulatorPid = child.pid || null;

                    child.unref();

                    // Wait a moment to check if process started successfully
                    await new Promise((resolve) => setTimeout(resolve, 500));

                    // Verify process is still running
                    if (emulatorPid !== null) {
                        try {
                            process.kill(emulatorPid, 0);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `X32 emulator started successfully (PID: ${emulatorPid}) from ${emulatorPath}. It is now running in the background so you can test without connecting to a physical mixer.`,
                                    },
                                ],
                            };
                        } catch {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `X32 emulator process started but appears to have exited immediately. Check if the emulator binary exists at ${emulatorPath} and is executable (chmod +x emulator/X32).`,
                                    },
                                ],
                                isError: true,
                            };
                        }
                    } else {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Failed to get PID from emulator process. The emulator may not have started correctly.`,
                                },
                            ],
                            isError: true,
                        };
                    }
                } catch (error) {
                    emulatorProcess = null;
                    emulatorPid = null;
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Failed to start X32 emulator: ${
                                    error instanceof Error ? error.message : String(error)
                                }. Make sure the emulator binary exists at emulator/X32 and is executable (chmod +x emulator/X32).`,
                            },
                        ],
                        isError: true,
                    };
                }
            }

            case "osc_stop_emulator": {
                try {
                    if (emulatorPid === null || emulatorProcess === null) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "X32 emulator is not running. Nothing to stop.",
                                },
                            ],
                        };
                    }

                    // Check if process is still alive
                    try {
                        process.kill(emulatorPid, 0);
                    } catch {
                        // Process already dead
                        emulatorProcess = null;
                        emulatorPid = null;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "X32 emulator process was not running (may have already stopped).",
                                },
                            ],
                        };
                    }

                    // Try to kill the process gracefully first (SIGTERM)
                    try {
                        process.kill(emulatorPid, "SIGTERM");
                        // Wait a bit for graceful shutdown
                        await new Promise((resolve) => setTimeout(resolve, 1000));

                        // Check if still running
                        try {
                            process.kill(emulatorPid, 0);
                            // Still running, force kill
                            process.kill(emulatorPid, "SIGKILL");
                        } catch {
                            // Process terminated successfully
                        }
                    } catch (killError) {
                        // If kill fails, process might already be dead
                        try {
                            process.kill(emulatorPid, 0);
                            // Still alive, try force kill
                            process.kill(emulatorPid, "SIGKILL");
                        } catch {
                            // Process is dead
                        }
                    }

                    emulatorProcess = null;
                    emulatorPid = null;

                    return {
                        content: [
                            {
                                type: "text",
                                text: "X32 emulator stopped successfully.",
                            },
                        ],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Failed to stop X32 emulator: ${error instanceof Error ? error.message : String(error)}`,
                            },
                        ],
                        isError: true,
                    };
                }
            }

            case "osc_get_emulator_status": {
                try {
                    if (emulatorPid === null) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "X32 emulator is not running.",
                                },
                            ],
                        };
                    }

                    // Check if process is still alive
                    try {
                        process.kill(emulatorPid, 0);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `X32 emulator is running (PID: ${emulatorPid}).`,
                                },
                            ],
                        };
                    } catch {
                        // Process is dead, reset variables
                        emulatorProcess = null;
                        emulatorPid = null;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "X32 emulator is not running (process has terminated).",
                                },
                            ],
                        };
                    }
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Error checking emulator status: ${error instanceof Error ? error.message : String(error)}`,
                            },
                        ],
                        isError: true,
                    };
                }
            }

            default:
                return {
                    content: [
                        {
                            type: "text",
                            text: `Unknown tool: ${name}`,
                        },
                    ],
                    isError: true,
                };
        }
    } catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});

// Start server
async function main() {
    console.error("Starting OSC MCP Server...");
    console.error(`Connecting to OSC device at ${OSC_HOST}:${OSC_PORT}`);

    await osc.connect();

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("OSC MCP Server running");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
