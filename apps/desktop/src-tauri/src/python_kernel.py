"""Trusted local Notebook bridge. Protocol: one JSON object per line, version 1."""
import base64
import binascii
import json
import re
import sys
import threading
import time
from html.parser import HTMLParser

from jupyter_client import KernelManager

lock = threading.Lock()
manager = KernelManager()
manager.start_kernel()
client = manager.client()
client.start_channels()
client.wait_for_ready(timeout=15)
running = threading.Event()
MAX_OUTPUT_BYTES = 1024 * 1024
MAX_IMAGE_BYTES = 768 * 1024


class DataFrameTable(HTMLParser):
    """Extract text cells from Pandas' table representation; never pass HTML onward."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_table = False
        self.section = None
        self.row = None
        self.cell = None
        self.headers = []
        self.rows = []
        self.truncated = False
        self.ignore = 0

    def handle_starttag(self, tag, attrs):
        if tag == "table" and not self.in_table and "dataframe" in dict(attrs).get("class", "").split():
            self.in_table = True
        elif self.in_table:
            if tag in ("script", "style"):
                self.ignore += 1
            elif tag in ("thead", "tbody"):
                self.section = tag
            elif tag == "tr":
                self.row = []
            elif tag in ("td", "th") and self.row is not None:
                self.cell = []

    def handle_data(self, data):
        if self.cell is not None and not self.ignore:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if not self.in_table:
            return
        if tag in ("script", "style") and self.ignore:
            self.ignore -= 1
        elif tag in ("td", "th") and self.cell is not None:
            if len(self.row) < 64:
                self.row.append("".join(self.cell).strip()[:4096])
            else:
                self.truncated = True
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.section == "thead":
                self.headers = self.row
            elif len(self.rows) < 200:
                self.rows.append(self.row)
            else:
                self.truncated = True
            self.row = None
        elif tag in ("thead", "tbody"):
            self.section = None
        elif tag == "table":
            self.in_table = False


def rich_output(content):
    bundle = content.get("data", {})
    plain = str(bundle.get("text/plain", ""))
    html = bundle.get("text/html")
    if isinstance(html, str) and len(html.encode("utf-8")) <= MAX_OUTPUT_BYTES:
        table = DataFrameTable()
        table.feed(html)
        if table.headers:
            columns = table.headers[:64]
            rows = [row[:64] for row in table.rows]
            return {"kind": "table", "text": plain[:8192], "columns": columns, "rows": rows, "truncated": table.truncated}
    for mime, signature in (("image/png", b"\x89PNG\r\n\x1a\n"), ("image/jpeg", b"\xff\xd8\xff")):
        encoded = bundle.get(mime)
        if not isinstance(encoded, str) or len(encoded) > MAX_IMAGE_BYTES * 4 // 3 + 16:
            continue
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            continue
        if raw.startswith(signature) and len(raw) <= MAX_IMAGE_BYTES:
            return {"kind": "image", "text": plain[:8192], "mime": mime, "data": encoded}
    return {"kind": "result", "text": plain or "[Unsupported rich output]"}


def output_size(item):
    if item["kind"] == "image":
        return len(item["data"]) * 3 // 4 + len(item["text"].encode("utf-8"))
    if item["kind"] == "table":
        return sum(len(cell.encode("utf-8")) for row in [item["columns"], *item["rows"]] for cell in row) + len(item["text"].encode("utf-8"))
    return len(item["text"].encode("utf-8"))


def send(value):
    with lock:
        sys.stdout.write(json.dumps({"version": 1, **value}, ensure_ascii=True) + "\n")
        sys.stdout.flush()


def install_inputs(inputs):
    # Silent setup does not consume a user execution count or echo transferred values.
    payload = json.dumps(inputs, ensure_ascii=True)
    setup = '''import json as _df_json
from decimal import Decimal as _df_Decimal
class _DataForgeInputs:
    def __init__(self, payload):
        self._inputs = {item["kind"]: item for item in _df_json.loads(payload)}
    def _frame(self, kind, selected_id=None):
        import pandas as _df_pd
        item = self._inputs.get(kind)
        if item is None or (selected_id is not None and selected_id != item["id"]):
            raise ValueError("Select this DataForge input in the Code cell before running it")
        columns = {}
        for index, column in enumerate(item["columns"]):
            values = [row[index] for row in item["rows"]]
            data_type = column["data_type"]
            if data_type == "integer":
                converted = [int(value) if value is not None else None for value in values]
                try:
                    series = _df_pd.Series(_df_pd.array(converted, dtype="Int64"))
                except (OverflowError, TypeError, ValueError):
                    series = _df_pd.Series(converted, dtype=object)
            elif data_type == "decimal":
                series = _df_pd.Series([_df_Decimal(value) if value is not None else None for value in values], dtype=object)
            elif data_type == "boolean":
                series = _df_pd.Series(_df_pd.array([None if value is None else value.lower() == "true" for value in values], dtype="boolean"))
            else:
                series = _df_pd.Series(values, dtype="string")
            columns[column["name"]] = series
        frame = _df_pd.DataFrame(columns)
        frame.attrs["dataforge"] = {key: item[key] for key in ("kind", "id", "source_fingerprint", "representation_id", "duckdb_version", "has_more")}
        return frame
    def dataset(self, dataset_id=None):
        return self._frame("dataset", dataset_id)
    def sql_result(self, execution_id=None):
        return self._frame("sql_result", execution_id)
dataforge = _DataForgeInputs(''' + repr(payload) + ''')'''
    message_id = client.execute(setup, silent=True, store_history=False, allow_stdin=False)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            reply = client.get_shell_msg(timeout=1)
        except Exception:
            continue
        if reply.get("parent_header", {}).get("msg_id") != message_id:
            continue
        if reply["content"].get("status") != "ok":
            raise RuntimeError("DataForge input setup failed: " + str(reply["content"].get("evalue", "unknown error"))[:300])
        return
    raise TimeoutError("DataForge input setup timed out")


def execute(command):
    outputs = []
    size = 0
    count = None
    status = "succeeded"
    try:
        install_inputs(command.get("inputs", []))
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
            elif kind in ("stream", "execute_result", "display_data", "error"):
                if kind == "stream":
                    item = {"kind": content.get("name", "stdout"), "text": content.get("text", "")}
                elif kind in ("execute_result", "display_data"):
                    count = content.get("execution_count", count)
                    item = rich_output(content)
                else:
                    status = "failed"
                    item = {"kind": "error", "text": "\n".join(content.get("traceback", []))}
                item["text"] = re.sub(r"\x1b\[[0-9;]*m", "", str(item["text"]))
                size += output_size(item)
                if size > MAX_OUTPUT_BYTES:
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
