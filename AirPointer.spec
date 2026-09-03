# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

# AirPointer only ever instantiates mp.solutions.hands.Hands(), but importing
# mediapipe.python.solutions eagerly imports every solution's Python module
# (mediapipe's own __init__.py does this, not us). That doesn't load their
# model weights though -- those are read from disk lazily, only when a
# solution object (Pose(), FaceMesh(), ...) is actually constructed. Since we
# never construct those, only bundle the hand/palm models we do use.
mediapipe_data = collect_data_files(
    "mediapipe", includes=["modules/hand_landmark/**/*", "modules/palm_detection/**/*"]
)
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
    excludes=["jax", "jaxlib", "pytest", "scipy", "tensorflow", "torch", "sounddevice"],
    noarchive=False,
    optimize=0,
)

# cv2 ships Haar cascade XML data for face/eye/body detection; AirPointer
# only uses MediaPipe hand tracking, so this is dead weight (~7MB).
a.datas = [entry for entry in a.datas if "cv2" + "\\data\\" not in entry[0] and "cv2/data/" not in entry[0]]

# sounddevice/portaudio (pulled in transitively by mediapipe's audio task
# modules, unused by AirPointer's hand-tracking-only code path) also isn't
# reliably readable mid-build on this machine -- Windows Defender's on-access
# scan holds a lock on the freshly-written binaries long enough that
# PyInstaller's own archive-packing step hits a PermissionError. Drop it from
# both datas and binaries so it's never even considered.
a.datas = [entry for entry in a.datas if "sounddevice" not in entry[0] and "portaudio" not in entry[0]]
a.binaries = [entry for entry in a.binaries if "sounddevice" not in entry[0] and "portaudio" not in entry[0]]

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
