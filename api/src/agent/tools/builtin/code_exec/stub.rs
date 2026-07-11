pub(super) fn python_tool_stub() -> &'static str {
    r#"import json
import os
import socket


_file_fingerprints = {}


def call_tool(name, **kwargs):
    socket_path = os.environ.get("MYMY_TOOLS_RPC_PATH")
    if not socket_path:
        raise RuntimeError("MYMY_TOOLS_RPC_PATH is not configured")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(socket_path)
        client.sendall((json.dumps({"tool": name, "args": kwargs}) + "\n").encode("utf-8"))
        response = b""
        while not response.endswith(b"\n"):
            chunk = client.recv(65536)
            if not chunk:
                break
            response += chunk
    payload = json.loads(response.decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error", "tool RPC failed"))
    return payload.get("result")


def read_file(path, offset=1, limit=500):
    result = call_tool("read_file", path=path, offset=offset, limit=limit)
    if result.get("fingerprint"):
        _file_fingerprints[path] = result["fingerprint"]
    return result


def search_files(query, path=None, limit=50):
    args = {"query": query, "limit": limit}
    if path is not None:
        args["path"] = path
    return call_tool("search_files", **args)


def write_file(path, content):
    args = {"path": path, "content": content}
    if path in _file_fingerprints:
        args["expectedFingerprint"] = _file_fingerprints[path]
    result = call_tool("write_file", **args)
    if result.get("fingerprint"):
        _file_fingerprints[path] = result["fingerprint"]
    return result


def patch_file(path, old_string, new_string):
    if path not in _file_fingerprints:
        read_file(path)
    result = call_tool(
        "patch_file",
        path=path,
        old_string=old_string,
        new_string=new_string,
        expectedFingerprint=_file_fingerprints[path],
    )
    if result.get("fingerprint"):
        _file_fingerprints[path] = result["fingerprint"]
    return result
"#
}
