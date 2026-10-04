"""Private local bridge token; never a command argument, environment value or log."""
import os
from pathlib import Path
import re
import secrets
import stat


def read_token(path: Path) -> str:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "r") as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise RuntimeError("token_permissions_invalid")
        value = stream.read(130)
        if len(value) > 129:
            raise RuntimeError("token_invalid")
        token = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
        raise RuntimeError("token_invalid")
    return token


def ensure_token(path: Path):
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        read_token(path)  # fail closed; setup must never rotate an existing token
        return
    with os.fdopen(descriptor, "w") as stream:
        stream.write(secrets.token_urlsafe(32) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
