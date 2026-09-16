# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

# winsdk (used by ocr_fallback.py) ships one compiled extension module per
# WinRT namespace, discovered at runtime rather than via a plain top-level
# import PyInstaller's static analysis can trace -- collect_submodules walks
# the package so the three namespaces we actually import
# (windows.graphics.imaging, windows.media.ocr, windows.storage.streams)
# aren't silently dropped from the build. NOT yet verified against a real
# portable-EXE build in this pass -- only unit-tested and exercised via a
# standalone script so far (see docs/replay-change-detection.md's "OCR
# 폴백" section).
winsdk_hidden = collect_submodules("winsdk")

a = Analysis(
    ["airpointer_launcher.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=winsdk_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["jax", "jaxlib", "pytest", "scipy", "tensorflow", "torch", "sounddevice"],
    noarchive=False,
    optimize=0,
)

# cv2 ships Haar cascade XML data for face/eye/body detection; replay does not use them.
a.datas = [entry for entry in a.datas if "cv2" + "\\data\\" not in entry[0] and "cv2/data/" not in entry[0]]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="AirPointer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
