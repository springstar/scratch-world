"""
Auto-rig a static humanoid GLB by parenting it to a template armature using
Blender Automatic Weights.

Usage (invoked by auto-rig.ts):
  blender --background --python rig_mesh.py -- \
    --template /path/to/base_humanoid.glb \
    --mesh    /path/to/generated.glb \
    --output  /path/to/rigged.glb

The template must be a GLB containing an Armature with animation actions.
UAL2_Standard.glb (Quaternius Universal Animation Library 2) is the default.
"""

import sys
import argparse
import bpy  # type: ignore  # Blender Python API — only available inside Blender
import mathutils  # type: ignore  # available inside Blender


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Auto-rig mesh to template armature")
    parser.add_argument("--template", required=True, help="Path to template GLB (armature + animations)")
    parser.add_argument("--mesh", required=True, help="Path to Hunyuan-generated static GLB")
    parser.add_argument("--output", required=True, help="Path for rigged output GLB")
    return parser.parse_args(argv)


def fresh_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str) -> list:
    """Import a GLB; return list of newly added objects."""
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    return [bpy.data.objects[k] for k in bpy.data.objects.keys() if k not in before]


def find_armature(objects=None):
    search = objects if objects is not None else list(bpy.data.objects)
    for obj in search:
        if obj.type == "ARMATURE":
            return obj
    return None


def find_meshes(objects: list) -> list:
    return [obj for obj in objects if obj.type == "MESH"]


def delete_objects(objects: list) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.object.delete()


def scale_and_center(mesh_objects: list, target_height: float = 1.8) -> None:
    """Scale all mesh objects uniformly to target_height, feet at Z=0, centred at XY=0."""
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            min_x = min(min_x, world.x); max_x = max(max_x, world.x)
            min_y = min(min_y, world.y); max_y = max(max_y, world.y)
            min_z = min(min_z, world.z); max_z = max(max_z, world.z)

    height = max_z - min_z
    if height > 0.001:
        sf = target_height / height
        for obj in mesh_objects:
            obj.scale *= sf
        bpy.ops.object.select_all(action="DESELECT")
        for obj in mesh_objects:
            obj.select_set(True)
        bpy.ops.object.transform_apply(scale=True)

    # Re-measure and centre
    min_x2 = min_y2 = min_z2 = float("inf")
    max_x2 = max_y2 = float("-inf")
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            min_x2 = min(min_x2, world.x); max_x2 = max(max_x2, world.x)
            min_y2 = min(min_y2, world.y); max_y2 = max(max_y2, world.y)
            min_z2 = min(min_z2, world.z)

    cx = (min_x2 + max_x2) / 2
    cy = (min_y2 + max_y2) / 2
    for obj in mesh_objects:
        obj.location.x -= cx
        obj.location.y -= cy
        obj.location.z -= min_z2
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
    bpy.ops.object.transform_apply(location=True)


def auto_weight_parent(armature, mesh_objects: list) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def export_glb(output_path: str) -> None:
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_apply=False,
        use_selection=False,
    )


def main() -> None:
    args = parse_args()

    fresh_scene()

    # ── Step 1: import template (armature + animations) ──────────────────────
    template_objects = import_glb(args.template)
    armature = find_armature(template_objects) or find_armature()
    if armature is None:
        print("[rig_mesh] ERROR: no Armature found in template", file=sys.stderr)
        sys.exit(1)
    print(f"[rig_mesh] armature: {armature.name}, actions: {len(bpy.data.actions)}")

    # Delete template character meshes and WGT-/control widgets — keep only the armature
    junk = [
        obj for obj in template_objects
        if obj.type == "MESH" or (obj.type == "EMPTY" and obj.name.startswith("WGT-"))
    ]
    if junk:
        delete_objects(junk)
        print(f"[rig_mesh] deleted {len(junk)} template mesh/widget objects")

    # ── Step 2: import Hunyuan mesh ───────────────────────────────────────────
    mesh_objects_all = import_glb(args.mesh)
    mesh_objects = find_meshes(mesh_objects_all)
    if not mesh_objects:
        print("[rig_mesh] ERROR: no Mesh found in mesh GLB", file=sys.stderr)
        sys.exit(1)
    print(f"[rig_mesh] imported {len(mesh_objects)} mesh objects from Hunyuan GLB")

    # Delete any armature or empty that came with the mesh GLB (Hunyuan can include these)
    mesh_junk = [obj for obj in mesh_objects_all if obj.type not in ("MESH",)]
    if mesh_junk:
        delete_objects(mesh_junk)

    # ── Step 3: normalise mesh (1.8 m, feet at origin, centred) ──────────────
    scale_and_center(mesh_objects, target_height=1.8)

    # ── Step 4: auto-weight parent to armature ────────────────────────────────
    auto_weight_parent(armature, mesh_objects)

    # ── Step 5: export ────────────────────────────────────────────────────────
    export_glb(args.output)
    print(f"[rig_mesh] exported rigged GLB to {args.output}")


if __name__ == "__main__":
    main()
