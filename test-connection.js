#!/usr/bin/env node

/**
 * Test script to verify OSC connection
 * Run with: node test-connection.js
 * example:
 * OSC_HOST=192.168.0.16 OSC_PORT=10024 OSC_PROTOCOL=OSCXR npm test
 * OSC_HOST=192.168.0.1 OSC_PORT=10023 OSC_PROTOCOL=OSCX32M32 npm test
 */

import { OSCClient } from "./dist/osc-client.js";

const OSC_HOST = process.env.OSC_HOST || "192.168.0.16";
const OSC_PORT = parseInt(process.env.OSC_PORT || "10024");
const OSC_PROTOCOL = parseOscProtocol(process.env.OSC_PROTOCOL);

console.log("🎚️  OSC Connection Test");
console.log("=".repeat(50));
console.log(`Host: ${OSC_HOST}`);
console.log(`Port: ${OSC_PORT}`);
console.log(`Protocol: ${OSC_PROTOCOL}`);
console.log("=".repeat(50));

const osc = new OSCClient(OSC_HOST, OSC_PORT, OSC_PROTOCOL);

function parseOscProtocol(value) {
    if (!value) return "OSCX32M32";
    if (value === "OSCX32M32" || value === "OSCXR") return value;
    throw new Error(`Invalid OSC_PROTOCOL "${value}". Expected "OSCX32M32" or "OSCXR".`);
}

async function test() {
    try {
        console.log("\n📡 Connecting to mixer...");
        await osc.connect();
        console.log("✅ Connected successfully!");

        console.log("\n📊 Getting mixer status...");
        const status = await osc.getMixerStatus();
        console.log("Status:", JSON.stringify(status, null, 2));

        console.log("\n🎚️  Testing fader control...");
        console.log("Getting channel 1 fader level...");
        try {
            const level = await osc.getFader(1);
            console.log(`✅ Channel 1 fader: ${(level * 100).toFixed(1)}%`);
        } catch (error) {
            console.log("⚠️  Could not get fader level (this is normal if the mixer doesn't respond to queries)");
        }

        console.log(`\n🧪 Running ${OSC_PROTOCOL} protocol smoke tests...`);
        await runProtocolSmokeTests();

        console.log("\n✅ All tests completed!");
        console.log("\n💡 Your mixer is ready to use with Claude Desktop!");
        console.log("\nNext steps:");
        console.log("1. Copy the configuration from claude_desktop_config.json");
        console.log("2. Add it to your Claude Desktop config file");
        console.log("3. Restart Claude Desktop");
        console.log("4. Start controlling your mixer with chat!");

    } catch (error) {
        console.error("\n❌ Connection failed!");
        console.error("Error:", error.message);
        console.error("\nTroubleshooting:");
        console.error("1. Check that your mixer is powered on");
        console.error("2. Verify the IP address is correct");
        console.error("3. Ensure your computer and mixer are on the same network");
        console.error("4. Try pinging the mixer: ping " + OSC_HOST);
        console.error("5. Check firewall settings for UDP port " + OSC_PORT);
        process.exit(1);
    } finally {
        osc.close();
        process.exit(0);
    }
}

async function runProtocolSmokeTests() {
    const checks = [
        ["Main LR fader", () => osc.getMainFader()],
        ["Channel 1 name", () => osc.getChannelName(1)],
        ["Bus 1 fader", () => osc.getBusFader(1)],
        ["FX return 1 on", () => osc.getEffectOn(1)],
        ["Headamp 1", () => osc.getHeadamp(1)],
        ["Scene 1 name", () => osc.getSceneName(1)],
    ];

    if (OSC_PROTOCOL === "OSCXR") {
        checks.push(["Aux return fader", () => osc.getAuxFader(1)]);
        checks.push(["FX return 1 to bus 1 level", () => osc.getFxToBus(1, 1)]);
        checks.push(["Aux return to bus 1 level", () => osc.getAuxToBus(1, 1)]);
    }

    for (const [label, fn] of checks) {
        try {
            const value = await fn();
            console.log(`✅ ${label}: ${JSON.stringify(value)}`);
        } catch (error) {
            console.log(`⚠️  ${label}: ${error.message}`);
        }
    }

    if (OSC_PROTOCOL === "OSCXR") {
        const guardChecks = [
            ["Console overview unsupported guard", () => osc.getConsoleOverview()],
            ["Channel-to-bus mute semantic guard", () => osc.muteChannelToBus(1, 1, true)],
        ];

        for (const [label, fn] of guardChecks) {
            try {
                await fn();
                console.log(`⚠️  Expected ${label} to be unsupported in OSCXR, but it returned.`);
            } catch (error) {
                if (error.message.includes("Unsupported for OSCXR")) {
                    console.log(`✅ ${label}: ${error.message}`);
                } else {
                    console.log(`⚠️  Unexpected ${label} error: ${error.message}`);
                }
            }
        }
    }
}

test();
