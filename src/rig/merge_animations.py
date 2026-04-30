"""
Merge selected animation actions from a source GLB into the base_humanoid.glb template.

Usage (run via Blender):
  blender --background --python src/rig/merge_animations.py -- \
    --source  /path/to/UAL1_Standard.glb \
    --base    /path/to/base_humanoid.glb \
    --output  /path/to/base_humanoid_merged.glb \
    --actions Walk_Loop Walk_Formal_Loop Jog_Fwd_Loop Sprint_Loop

Requires both GLBs to share the same bone names (UAL1 and UAL2 are compatible).
"""

import sys
import argparse
import bpy  # type: ignore


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--actions", nargs="+", default=["Walk_Loop", "Walk_Formal_Loop", "Jog_Fwd_Loop", "Sprint_Loop"])
    return parser.parse_args(argv)


def import_glb(path: str) -> list:
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    return [bpy.data.objects[k] for k in bpy.data.objects.keys() if k not in before]


def find_armature(objects: list):
    for obj in objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import base (UAL2 — has the 43 action animations)
    print("[merge] importing base:", args.base)
    base_objs = import_glb(args.base)
    base_arm = find_armature(base_objs)
    if base_arm is None:
        print("[merge] ERROR: no armature in base GLB", file=sys.stderr)
        sys.exit(1)
    base_actions = {a.name for a in bpy.data.actions}
    print(f"[merge] base has {len(base_actions)} actions")

    # Import source (UAL1 — has Walk_Loop etc.)
    print("[merge] importing source:", args.source)
    src_objs = import_glb(args.source)
    src_arm = find_armature(src_objs)
    if src_arm is None:
        print("[merge] ERROR: no armature in source GLB", file=sys.stderr)
        sys.exit(1)

    # Copy requested actions from source into base armature
    copied = []
    for action_name in args.actions:
        if action_name not in bpy.data.actions:
            print(f"[merge] WARNING: action '{action_name}' not found in source, skipping")
            continue
        if action_name in base_actions:
            print(f"[merge] '{action_name}' already exists in base, skipping")
            continue
        action = bpy.data.actions[action_name]
        action.use_fake_user = True
        copied.append(action_name)
        print(f"[merge] copied: {action_name}")

    # Remove source armature (keep only base armature + merged actions)
    for obj in src_objs:
        obj.user_clear()
        bpy.data.objects.remove(obj, do_unlink=True)

    print(f"[merge] total actions now: {len(bpy.data.actions)}")

    # Export merged GLB
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_apply=False,
        use_selection=False,
    )
    print(f"[merge] exported to {args.output}")
    print(f"[merge] added actions: {copied}")


if __name__ == "__main__":
    main()
