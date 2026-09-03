# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

mediapipe_data = collect_data_files("mediapipe", includes=["modules/**/*"])
mediapipe_binaries = collect_dynamic_libs("mediapipe")
mediapipe_hidden = [
    "mediapipe.python.solutions.hands",
]

a = Analysis(
    ["airpointer_launcher.py"],
    pathex=[],
    binaries=mediapipe_binaries,
    datas=mediapipe_data,
    hiddenimports=mediapipe_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["jax", "jaxlib", "pytest", "scipy", "tensorflow", "torch"],
    noarchive=False,
    optimize=0,
)
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
