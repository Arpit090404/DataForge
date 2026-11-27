"""Trusted local Notebook bridge. Protocol: one JSON object per line, version 2."""
import ast
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
input_ready = threading.Event()
input_response = {}
pending_input_id = None
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
        sys.stdout.write(json.dumps({"version": 2, **value}, ensure_ascii=True) + "\n")
        sys.stdout.flush()


def install_inputs(inputs):
    # Silent setup does not consume a user execution count or echo transferred values.
    payload = json.dumps(inputs, ensure_ascii=True)
    setup = '''import json as _df_json
from decimal import Decimal as _df_Decimal
class _DataForgeInputs:
    def __init__(self, payload):
        self._inputs = _df_json.loads(payload)
        self._publications = {}
    def _frame(self, kind, selected_id=None):
        import pandas as _df_pd
        matches = [item for item in self._inputs if item["kind"] == kind and
                   (selected_id is None or selected_id in (item["id"], item.get("name")))]
        if len(matches) != 1:
            raise ValueError("Dataset unavailable or ambiguous. Use a registered name or stable dataset_<id> handle")
        item = matches[0]
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
        frame.attrs["dataforge"]["extent"] = "complete" if not item["has_more"] else "truncated"
        return frame
    def dataset(self, dataset_id=None):
        return self._frame("dataset", dataset_id)
    def sql_result(self, execution_id=None):
        return self._frame("sql_result", execution_id)
    def result(self, name):
        return self._frame("named_result", name)
    def publish(self, name, frame):
        import pandas as _df_pd
        if not isinstance(name, str) or not isinstance(frame, _df_pd.DataFrame):
            raise ValueError("Publish requires a result name and Pandas DataFrame")
        if name in self._publications:
            raise ValueError("Publish each result name once per cell")
        if len(frame) > 200 or len(frame.columns) == 0 or len(frame.columns) > 128:
            raise ValueError("Published results require 1-128 columns and at most 200 complete rows")
        names = list(frame.columns)
        if any(not isinstance(n, str) or not n or len(n) > 255 for n in names) or len({n.lower() for n in names}) != len(names):
            raise ValueError("Published results require unique nonempty text column names")
        columns = []
        for name_column in names:
            series = frame[name_column]
            dtype = series.dtype
            if _df_pd.api.types.is_bool_dtype(dtype):
                kind = "boolean"
            elif _df_pd.api.types.is_integer_dtype(dtype):
                kind = "integer"
            elif _df_pd.api.types.is_float_dtype(dtype) or series.dropna().map(lambda v: isinstance(v, _df_Decimal)).all() and len(series.dropna()):
                kind = "decimal"
            else:
                kind = "text"
            columns.append({"name": name_column, "data_type": kind})
        rows = []
        for row in frame.itertuples(index=False, name=None):
            values = []
            for value in row:
                if hasattr(value, "item") and not isinstance(value, (str, int, float, bool, _df_Decimal)):
                    value = value.item()
                if value is None or value is _df_pd.NA or isinstance(value, float) and _df_pd.isna(value):
                    values.append(None)
                elif isinstance(value, (str, int, float, bool, _df_Decimal)):
                    values.append(str(value).lower() if isinstance(value, bool) else str(value))
                else:
                    raise ValueError("Published DataFrames must contain scalar values")
            rows.append(values)
        item = {"name": name, "columns": columns, "rows": rows}
        if len(_df_json.dumps(item).encode("utf-8")) > 1024 * 1024:
            raise ValueError("Published result exceeds the 1 MiB limit")
        self._publications[name] = item
        return frame
    def _export(self):
        return _df_json.dumps(list(self._publications.values()), ensure_ascii=True)
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
    global pending_input_id
    outputs = []
    size = 0
    count = None
    status = "succeeded"
    publications = []
    try:
        inputs = list(command.get("inputs", []))
        names = []
        result_names = []
        try:
            parsed = ast.parse(command["code"])
        except SyntaxError:
            parsed = None  # IPython syntax remains the kernel's responsibility.
        for node in ast.walk(parsed) if parsed is not None else ():
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "dataforge" and node.func.attr == "dataset":
                if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
                    if not inputs:
                        raise ValueError("Use a literal registered dataset name in dataforge.dataset(\"name\")")
                    continue
                if node.args[0].value not in names and not any(item.get("name") == node.args[0].value or item["id"] == node.args[0].value for item in inputs):
                    names.append(node.args[0].value)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "dataforge" and node.func.attr == "result":
                if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
                    raise ValueError("Use a literal published result name in dataforge.result(\"name\")")
                if node.args[0].value not in result_names:
                    result_names.append(node.args[0].value)
        if names or result_names:
            input_ready.clear()
            input_response.clear()
            pending_input_id = command["id"]
            send({"id": command["id"], "status": "input_request", "names": names, "result_names": result_names})
            if not input_ready.wait(30):
                raise TimeoutError("Dataset input request timed out")
            if input_response.get("error"):
                raise ValueError(input_response["error"])
            inputs.extend(input_response.get("inputs", []))
        install_inputs(inputs)
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
        if status == "succeeded":
            export_id = client.execute("", silent=True, store_history=False, allow_stdin=False,
                                       user_expressions={"published": "dataforge._export()"})
            export_reply = None
            export_deadline = time.monotonic() + 15
            while time.monotonic() < export_deadline:
                candidate = client.get_shell_msg(timeout=max(0.1, export_deadline - time.monotonic()))
                if candidate.get("parent_header", {}).get("msg_id") == export_id:
                    export_reply = candidate
                    break
            if export_reply is None or export_reply["content"].get("status") != "ok":
                raise RuntimeError("Published results could not be read from the kernel")
            expression = export_reply["content"]["user_expressions"]["published"]
            if expression.get("status") != "ok":
                raise RuntimeError("Published results could not be serialized")
            publications = json.loads(ast.literal_eval(expression["data"]["text/plain"]))
    except Exception as exc:
        status = "failed"
        outputs.append({"kind": "error", "text": str(exc)[:500]})
    finally:
        pending_input_id = None
        running.clear()
        send({"id": command["id"], "status": status, "count": count, "outputs": outputs, "publications": publications})


try:
    send({"id": "ready", "status": "ready", "python": sys.version.split()[0]})
    for line in sys.stdin:
        command = {}
        try:
            command = json.loads(line)
            if command.get("version") != 2:
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
            elif action == "inputs" and running.is_set() and command.get("id") == pending_input_id:
                input_response.clear()
                input_response.update(command)
                input_ready.set()
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
