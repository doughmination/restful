#!/usr/bin/env node
/*
 * Decode a Discord `X-Super-Properties` base64 blob and surface the fields that
 * matter for the client fingerprint (build number, channel, browser, locale).
 */

function clean(s) {
  return s
    .trim()
    .replace(/^x-super-properties:\s*/i, "") // tolerate the full header line
    .replace(/^["']|["']$/g, "") // tolerate surrounding quotes
    .trim();
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const arg = process.argv.slice(2).join(" ");
const b64 = clean(arg || (await readStdin()));

if (!b64) {
  console.error('Usage: pnpm decode "<X-Super-Properties base64>"');
  process.exit(1);
}

let props;
try {
  props = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
} catch (e) {
  console.error("Could not decode/parse that value:", e.message);
  process.exit(1);
}

const pick = (k) => (props[k] ?? "(absent)");

console.log("\nDecoded X-Super-Properties:\n");
console.log(JSON.stringify(props, null, 2));

console.log("\nFingerprint fields that matter:");
console.log(`  client_build_number : ${pick("client_build_number")}`);
console.log(`  release_channel     : ${pick("release_channel")}`);
console.log(`  browser             : ${pick("browser")} ${pick("browser_version")}`);
console.log(`  os                  : ${pick("os")} ${pick("os_version")}`);
console.log(`  system_locale       : ${pick("system_locale")}`);

if (props.client_build_number != null) {
  console.log(
    `\nDrop into wrangler.jsonc:  "DISCORD_CLIENT_BUILD_NUMBER": "${props.client_build_number}"`
  );
}
console.log("");
