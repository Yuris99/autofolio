# Starts the local Laya server AutoFolio asks (http://127.0.0.1:8000/v1/systemone).
# Install once: pip install "laya[serve]"    Run: powershell -ExecutionPolicy Bypass -File tools\laya-serve.ps1
# See docs/laya.md.

# Korean Windows reads files as cp949 by default; PyTorch then fails with UnicodeDecodeError.
$env:PYTHONUTF8 = "1"
# Without Developer Mode, Windows cannot make the symlinks the Hugging Face cache prefers; it copies instead.
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
# Only this PC needs to reach it.
$env:LAYA_HOST = "127.0.0.1"
$env:LAYA_PRELOAD = "1"

laya-serve
