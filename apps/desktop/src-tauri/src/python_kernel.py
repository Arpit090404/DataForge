"""Trusted local Notebook bridge. Protocol: one JSON object per line, version 1."""
import json
import re
import sys
import threading
import time

from jupyter_client import KernelManager

lock = threading.Lock()
manager = KernelManager()
manager.start_kernel()
client = manager.client()
client.start_channels()
client.wait_for_ready(timeout=15)
running = threading.Event()


def send(value):
    with lock:
        sys.stdout.write(json.dumps({"version": 1, **value}, ensure_ascii=True) + "\n")
        sys.stdout.flush()


def execute(command):
    outputs = []
    size = 0
    count = None
    status = "succeeded"
    try:
        message_id = client.execute(command["code"], store_history=True, allow_stdin=False, stop_on_error=True)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                event = client.get_iopub_msg(timeout=0.2)
            except Exception:
                continue
            if event.get("parent_header", {}).get("msg_id") != message_id:
                continue
            kind = event["header"]["msg_type"]
            content = event["content"]
            if kind == "execute_input":
                count = content.get("execution_count")
            elif kind in ("stream", "execute_result", "error"):
                if kind == "stream":
                    item = {"kind": content.get("name", "stdout"), "text": content.get("text", "")}
                elif kind == "execute_result":
                    count = content.get("execution_count", count)
                    item = {"kind": "result", "text": content.get("data", {}).get("text/plain", "")}
                else:
                    status = "failed"
                    item = {"kind": "error", "text": "\n".join(content.get("traceback", []))}
                item["text"] = re.sub(r"\x1b\[[0-9;]*m", "", str(item["text"]))
                size += len(item["text"].encode("utf-8"))
                if size > 1024 * 1024:
                    outputs.append({"kind": "error", "text": "Output exceeded 1 MB and was truncated."})
                    status = "failed"
                    manager.interrupt_kernel()
                    break
                outputs.append(item)
            elif kind == "status" and content.get("execution_state") == "idle":
                break
        else:
            status = "interrupted"
            manager.interrupt_kernel()
            outputs.append({"kind": "error", "text": "Execution exceeded 60 seconds."})
    except Exception as exc:
        status = "failed"
        outputs.append({"kind": "error", "text": str(exc)[:500]})
    finally:
        running.clear()
        send({"id": command["id"], "status": status, "count": count, "outputs": outputs})


try:
    send({"id": "ready", "status": "ready", "python": sys.version.split()[0]})
    for line in sys.stdin:
        command = {}
        try:
            command = json.loads(line)
            if command.get("version") != 1:
                raise ValueError("Unsupported bridge version")
            action = command.get("action")
            if action == "execute":
                if running.is_set():
                    send({"id": command["id"], "status": "busy", "outputs": []})
                else:
                    running.set()
                    threading.Thread(target=execute, args=(command,), daemon=True).start()
            elif action == "interrupt":
                manager.interrupt_kernel()
            elif action == "restart" and not running.is_set():
                client.stop_channels()
                manager.restart_kernel(now=True)
                client = manager.client()
                client.start_channels()
                client.wait_for_ready(timeout=15)
                send({"id": command["id"], "status": "restarted"})
            elif action == "shutdown":
                break
        except Exception as exc:
            send({"id": command.get("id", "unknown"), "status": "failed", "outputs": [{"kind": "error", "text": str(exc)[:500]}]})
finally:
    client.stop_channels()
    manager.shutdown_kernel(now=True)
