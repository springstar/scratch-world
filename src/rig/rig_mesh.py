"""
Auto-rig a static humanoid GLB by parenting it to a template armature using
Blender Automatic Weights.

Usage (invoked by auto-rig.ts):
  blender --background --python rig_mesh.py -- \
    --template /path/to/base_humanoid.blend \
    --mesh    /path/to/generated.glb \
    --output  /path/to/rigged.glb

The template may be a .blend file (preferred) or a .glb/.gltf file.
It must contain at least one Armature object with animation actions.

The mesh GLB must contain at least one Mesh object.
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
    parser.add_argument("--template", required=True, help="Path to template .blend or GLB (armature + animations)")
    parser.add_argument("--mesh", required=True, help="Path to Hunyuan-generated static GLB")
    parser.add_argument("--output", required=True, help="Path for rigged output GLB")
    return parser.parse_args(argv)


def load_template_blend(path: str) -> None:
    """Open a .blend file as the working scene."""
    bpy.ops.wm.open_mainfile(filepath=path)


def load_template_glb(path: str) -> None:
    """Fresh scene then import a GLB template."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)


def import_mesh_glb(path: str) -> list:
    """Import mesh GLB into the current scene; return newly added objects."""
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    return [bpy.data.objects[k] for k in bpy.data.objects.keys() if k not in before]


def find_armature(objects=None):
    """Find the first Armature in the given list, or in the whole scene."""
    search = objects if objects is not None else list(bpy.data.objects)
    for obj in search:
        if obj.type == "ARMATURE":
            return obj
    return None


def find_meshes(objects: list) -> list:
    return [obj for obj in objects if obj.type == "MESH"]


def scale_and_center(mesh_objects: list, target_height: float = 1.8) -> None:
    """Scale all mesh objects uniformly to target_height, feet at Z=0, centred at XY=0."""
    # Compute combined world-space bounding box
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
        # Apply scale
        bpy.ops.object.select_all(action="DESELECT")
        for obj in mesh_objects:
            obj.select_set(True)
        bpy.ops.object.transform_apply(scale=True)

    # Re-measure after scale
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
    """Parent mesh objects to armature using Automatic Weights."""
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

    # Load template (armature + animations)
    if args.template.lower().endswith(".blend"):
        load_template_blend(args.template)
    else:
        load_template_glb(args.template)

    armature = find_armature()
    if armature is None:
        print("[rig_mesh] ERROR: no Armature found in template", file=sys.stderr)
        sys.exit(1)

    # Import Hunyuan mesh into the current scene
    new_objects = import_mesh_glb(args.mesh)
    mesh_objects = find_meshes(new_objects)
    if not mesh_objects:
        print("[rig_mesh] ERROR: no Mesh found in mesh GLB", file=sys.stderr)
        sys.exit(1)

    # Normalise: 1.8 m tall, feet at origin, centred
    scale_and_center(mesh_objects, target_height=1.8)

    # Parent with Automatic Weights
    auto_weight_parent(armature, mesh_objects)

    # Export rigged GLB
    export_glb(args.output)
    print(f"[rig_mesh] exported rigged GLB to {args.output}")


if __name__ == "__main__":
    main()
