import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Streams lid angle readings to the browser as Server-Sent Events.
 *
 * The sensor is only reachable through IOKit, so the reading happens in the `lid-angle`
 * helper (see `native/lid-angle`) and this route is the pipe between that process's
 * stdout and the browser. One helper process per connected client, killed when the
 * client goes away.
 *
 * Every failure — no helper binary, no sensor on this Mac — arrives as a `sensor-error`
 * event rather than an HTTP status, so a client only has to read one channel.
 */

// Not statically analysable, which is the point of the turbopackIgnore comments below:
// the helper is a native binary built on this machine by `npm run build:native`, so it
// must not be traced as a project file and bundled into the server output.
const binary =
  process.env.LID_ANGLE_BIN ??
  path.join(process.cwd(), "native", "lid-angle", "bin", "lid-angle");

/** Polling rate handed to the helper, in Hz. */
const pollRate = "30";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let child: ChildProcess | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const fail = (message: string) => {
        send("sensor-error", { message });
        if (open) {
          open = false;
          controller.close();
        }
      };

      if (!existsSync(/*turbopackIgnore: true*/ binary)) {
        // Just the fact. What to do about it depends on the browser at the other end,
        // which only the client can see — a deployment has no helper to build.
        fail(`no lid-angle helper at ${binary}`);
        return;
      }

      child = spawn(/*turbopackIgnore: true*/ binary, ["--hz", pollRate], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // The helper writes one JSON object per line, but a chunk can split mid-line, so
      // hold the tail until its newline arrives. Lines are already JSON, so they go out
      // verbatim instead of being parsed and re-serialized.
      let pending = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (open && line.length > 0) {
            controller.enqueue(encoder.encode(`event: angle\ndata: ${line}\n\n`));
          }
        }
      });

      // The helper explains itself on stderr when there is no usable sensor; pass that
      // through rather than leaving the client with a bare disconnect.
      let stderr = "";
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => fail(error.message));
      child.on("close", (code, signal) => {
        // A kill from our own teardown is not a failure worth reporting.
        if (code === 0 || signal !== null) {
          if (open) {
            open = false;
            controller.close();
          }
          return;
        }
        fail(stderr.trim() || `lid-angle helper exited with code ${code}`);
      });

      request.signal.addEventListener("abort", () => {
        child?.kill();
        if (open) {
          open = false;
          controller.close();
        }
      });
    },

    cancel() {
      // The reader went away (tab closed, navigated). Killing the helper here as well as
      // on `abort` means no orphaned process whichever signal arrives first.
      child?.kill();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells proxies that buffer by default (nginx) to let each event through.
      "X-Accel-Buffering": "no",
    },
  });
}
