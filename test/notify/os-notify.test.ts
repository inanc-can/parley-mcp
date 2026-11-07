import { describe, expect, it } from "vitest";
import {
  PREVIEW_LIMIT,
  agreementNotice,
  conflictNotice,
  osNotifier,
  pausedNotice,
  preview,
} from "../../src/notify/os-notify.js";

const NOTICE = { kind: "paused" as const, title: "Parley: thread paused", body: `x"; do shell script "rm -rf ~"; "` };

function recorder(): { calls: { command: string; args: string[] }[]; run: (c: string, a: string[]) => void } {
  const calls: { command: string; args: string[] }[] = [];
  return { calls, run: (command, args) => calls.push({ command, args }) };
}

describe("osNotifier", () => {
  it("macOS: passes the text as osascript arguments, never inside the script", () => {
    const r = recorder();
    osNotifier({ platform: "darwin", run: r.run })(NOTICE);
    const call = r.calls[0];
    expect(call?.command).toBe("osascript");
    const scriptParts = call?.args.filter((_, i) => call.args[i - 1] === "-e") ?? [];
    expect(scriptParts.join("\n")).not.toContain("rm -rf");
    expect(call?.args.slice(-2)).toEqual([NOTICE.body, NOTICE.title]);
  });

  it("Linux: uses notify-send only when it is installed", () => {
    const withIt = recorder();
    osNotifier({ platform: "linux", run: withIt.run, onPath: () => true })(NOTICE);
    expect(withIt.calls[0]).toEqual({ command: "notify-send", args: ["--app-name=Parley", NOTICE.title, NOTICE.body] });
    const without = recorder();
    osNotifier({ platform: "linux", run: without.run, onPath: () => false })(NOTICE);
    expect(without.calls).toEqual([]);
  });

  it("Windows: does nothing in v1", () => {
    const r = recorder();
    osNotifier({ platform: "win32", run: r.run, onPath: () => true })(NOTICE);
    expect(r.calls).toEqual([]);
  });

  it("never throws when the OS command fails", () => {
    const notify = osNotifier({
      platform: "darwin",
      run: () => {
        throw new Error("spawn failed");
      },
    });
    expect(() => {
      notify(NOTICE);
    }).not.toThrow();
  });
});

describe("notice text", () => {
  const long = "a".repeat(200);

  it("never carries more than a 60-character preview of content", () => {
    expect(preview(long)).toHaveLength(PREVIEW_LIMIT);
    expect(preview("  short\n text ")).toBe("short text");
    for (const notice of [pausedNotice(long, 20), agreementNotice("a@r", "b@r", long), conflictNotice(long, "a@r", ["b@r"])]) {
      expect(notice.body).not.toContain("a".repeat(PREVIEW_LIMIT));
    }
  });

  it("says what happened and what the human can do", () => {
    expect(pausedNotice("Fix login", 20).body).toContain("20-message cap");
    expect(agreementNotice("a@r", "b@r", "a owns src/").body).toContain("Veto");
    expect(conflictNotice("src/x.ts", "a@r", ["b@r", "c@r"]).body).toContain("b@r, c@r");
  });
});
