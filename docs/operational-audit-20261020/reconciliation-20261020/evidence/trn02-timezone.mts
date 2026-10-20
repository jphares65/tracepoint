// TRN-02 isolated reproduction. Extracts the two functions verbatim from the
// current worktree source text, then runs browser-side code under the browser TZ
// and server-side code under the server TZ (separate processes via env TZ).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const CUR = process.argv[2];
const editor = readFileSync(`${CUR}/src/app/components/AgencyTrainingEventEditor.tsx`, "utf8");
const route = readFileSync(`${CUR}/src/app/api/agency-training/events/route.ts`, "utf8");
const grab = (src: string, name: string) => {
  const m = src.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`));
  if (!m) throw new Error(`missing ${name}`);
  return m[0].replace(/\(value: [^)]*\)/, "(value)");
};
const local = grab(editor, "localDateTimeValue");
const server = "function text(v){return typeof v==='string'?v.trim():'';}\n" + grab(route, "dateTimeOrNull");
const run = (tz: string, code: string) =>
  execFileSync(process.execPath, ["-e", code], { env: { ...process.env, TZ: tz } }).toString().trim();
const BROWSER_TZ = "America/Los_Angeles", SERVER_TZ = process.env.SERVER_TZ ?? "UTC";
let typed = "2026-10-24T18:00"; // coordinator types 18:00 local (Pacific)
console.log(`browser TZ=${BROWSER_TZ} server TZ=${SERVER_TZ}`);
for (let save = 1; save <= 3; save++) {
  // client sends draft.startsAt (raw datetime-local string) -> server dateTimeOrNull
  const stored = run(SERVER_TZ, `${server}\nconsole.log(dateTimeOrNull(${JSON.stringify(typed)}))`);
  // editor re-opens event: localDateTimeValue(event.startsAt) in browser TZ
  const shown = run(BROWSER_TZ, `${local}\nconsole.log(localDateTimeValue(${JSON.stringify(stored)}))`);
  console.log(`save ${save}: sent=${typed} stored=${stored} redisplayed=${shown}`);
  typed = shown; // next edit re-sends the displayed value unchanged
}
const intended = run(BROWSER_TZ, `console.log(new Date("2026-10-24T18:00").toISOString())`);
console.log(`intended instant (browser-local 18:00) = ${intended}`);
