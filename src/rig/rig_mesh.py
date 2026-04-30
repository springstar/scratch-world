"""
Auto-rig a static humanoid GLB by parenting it to a template armature using
Blender Automatic Weights (heat-map).

Usage (invoked by auto-rig.ts):
  blender --background --python rig_mesh.py -- \
    --template /path/to/base_humanoid.glb \
    --mesh    /path/to/generated.glb \
    --output  /path/to/rigged.glb

The template must be a GLB containing an Armature with animation actions.
UAL2_Standard.glb (Quaternius Universal Animation Library 2) is the default.

Requires Blender 4.x: ARMATURE_AUTO (heat weighting) was rewritten in 4.0 to
not require a 3D viewport context, so it works correctly in --background mode.
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


def purge_non_armature_objects() -> None:
    """Remove all MESH and EMPTY objects from the scene using data-level removal.

    bpy.ops.object.delete() silently fails to remove mesh objects that are
    referenced as bone custom shapes (e.g. the Icosphere in UAL2_Standard.glb
    is used as the root bone's custom shape). Using bpy.data.objects.remove()
    with do_unlink=True forcefully removes the object regardless of users.
    """
    for obj in list(bpy.data.objects):
        if obj.type in ("MESH", "EMPTY"):
            obj.user_clear()
            bpy.data.objects.remove(obj, do_unlink=True)


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


def clean_mesh(mesh_objects: list) -> None:
    """Remove duplicate vertices and fix non-manifold geometry.

    ARMATURE_AUTO heat-weighting silently assigns 0 weights if the mesh has
    duplicate vertices, degenerate faces, or non-manifold edges. Running a
    basic cleanup pass makes the mesh valid for heat weighting.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=0.0001)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)


def envelope_weight_parent(armature, mesh_objects: list) -> None:
    """Parent mesh objects to armature using heat-map automatic weights.

    ARMATURE_AUTO (heat weighting) traces geodesic distance on the mesh surface
    to assign per-bone influence — significantly more accurate than envelope
    weighting for meshes whose proportions differ from the template.

    Requires Blender 4.x: the heat-weighting algorithm was rewritten in 4.0 to
    no longer require a 3D viewport / GPU context, so it works correctly in
    headless --background mode.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def transfer_leaf_weights(mesh_objects: list) -> None:
    """Transfer weights from _leaf end-effector bones to their parent bones.

    Leaf bones (names ending in _leaf) are IK chain end-points and should not
    deform the mesh. ARMATURE_AUTO may assign weights to them; those weights
    are transferred to the nearest non-leaf ancestor to prevent mesh artifacts
    (e.g. shoe deformation during walk animation caused by ball_leaf_l/r).
    """
    for obj in mesh_objects:
        if obj.type != "MESH":
            continue
        leaf_groups = [vg for vg in obj.vertex_groups if vg.name.endswith("_leaf")]
        transferred = 0
        for leaf_vg in leaf_groups:
            parent_name = leaf_vg.name[: -len("_leaf")]
            parent_vg = obj.vertex_groups.get(parent_name)
            for v in obj.data.vertices:
                leaf_w = 0.0
                for g in v.groups:
                    if g.group == leaf_vg.index:
                        leaf_w = g.weight
                        break
                if leaf_w < 0.001:
                    continue
                # Zero the leaf weight
                leaf_vg.add([v.index], 0.0, "REPLACE")
                if parent_vg is not None:
                    # Add to parent (clamped)
                    cur = 0.0
                    for g in v.groups:
                        if g.group == parent_vg.index:
                            cur = g.weight
                            break
                    parent_vg.add([v.index], min(1.0, cur + leaf_w), "REPLACE")
                transferred += 1
        if transferred:
            print(f"[rig_mesh] {obj.name}: transferred {transferred} leaf-bone weights")


def lock_foot_region_weights(mesh_objects: list, foot_height_fraction: float = 0.12) -> None:
    """In the lowest N% of mesh height, zero non-foot-family bones and renormalize.

    Keeps foot_l, foot_r, ball_l, ball_r (the four natural foot-family bones) and
    zeros everything else (calf, shin, thigh, etc.).  Preserving ball_l/ball_r
    allows correct plantar-flexion (toe-down during toe-off) without the calf bone
    stretching the shoe.  Renormalizes the four kept weights to sum = 1.0.
    """
    FOOT_FAMILY = {"foot_l", "foot_r", "ball_l", "ball_r"}

    for obj in mesh_objects:
        if obj.type != "MESH":
            continue
        zvals = [v.co.z for v in obj.data.vertices]
        z_min, z_max = min(zvals), max(zvals)
        z_thresh = z_min + (z_max - z_min) * foot_height_fraction

        foot_vgs = {name: obj.vertex_groups.get(name) for name in FOOT_FAMILY}
        missing = [n for n, vg in foot_vgs.items() if vg is None]
        if missing:
            print(f"[rig_mesh] WARNING: {obj.name} missing {missing}, skipping foot lock")
            continue

        other_vgs = [vg for vg in obj.vertex_groups if vg.name not in FOOT_FAMILY]
        locked = 0
        for v in obj.data.vertices:
            if v.co.z > z_thresh:
                continue
            # Read foot-family weights from ARMATURE_AUTO
            fw: dict[str, float] = {name: 0.0 for name in FOOT_FAMILY}
            for g in v.groups:
                name = obj.vertex_groups[g.group].name
                if name in FOOT_FAMILY:
                    fw[name] = g.weight
            # Zero all non-foot-family bones
            for vg in other_vgs:
                vg.add([v.index], 0.0, "REPLACE")
            # Renormalize foot family to sum = 1.0
            total = sum(fw.values())
            if total < 0.001:
                # Fallback: UAL2 facing +Y → character left = +X (foot_l), right = -X (foot_r)
                if v.co.x >= 0:
                    foot_vgs["foot_l"].add([v.index], 1.0, "REPLACE")  # type: ignore[union-attr]
                else:
                    foot_vgs["foot_r"].add([v.index], 1.0, "REPLACE")  # type: ignore[union-attr]
            else:
                for name, vg in foot_vgs.items():
                    vg.add([v.index], fw[name] / total, "REPLACE")  # type: ignore[union-attr]
            locked += 1
        print(f"[rig_mesh] {obj.name}: locked {locked} foot-region vertices (foot+ball family, calf zeroed)")


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

    # Remove all mesh/empty objects from the template — including bone custom
    # shapes that bpy.ops.object.delete() cannot remove (e.g. Icosphere).
    purge_non_armature_objects()
    print(f"[rig_mesh] scene after template cleanup: {[o.name for o in bpy.data.objects]}")

    # ── Step 2: import Hunyuan mesh ───────────────────────────────────────────
    mesh_objects_all = import_glb(args.mesh)
    mesh_objects = find_meshes(mesh_objects_all)
    if not mesh_objects:
        print("[rig_mesh] ERROR: no Mesh found in mesh GLB", file=sys.stderr)
        sys.exit(1)
    print(f"[rig_mesh] imported {len(mesh_objects)} mesh objects from Hunyuan GLB")

    # Delete any non-mesh objects imported with the Hunyuan GLB
    for obj in mesh_objects_all:
        if obj.type not in ("MESH",):
            obj.user_clear()
            bpy.data.objects.remove(obj, do_unlink=True)

    # ── Step 3: normalise mesh (1.8 m, feet at origin, centred) ──────────────
    scale_and_center(mesh_objects, target_height=1.8)

    # ── Step 4: clean mesh before weight assignment ───────────────────────────
    clean_mesh(mesh_objects)

    # ── Step 5: heat-weight parent to armature ────────────────────────────────
    envelope_weight_parent(armature, mesh_objects)

    # ── Step 5b: transfer _leaf end-effector weights to parent bones ──────────
    transfer_leaf_weights(mesh_objects)

    # ── Step 5c: force foot-region vertices to foot+ball family only ─────────
    # Keeps foot_l/r + ball_l/r, zeros calf/shin/thigh bleed-in.
    lock_foot_region_weights(mesh_objects, foot_height_fraction=0.12)

    # Verify weights were assigned
    for m in mesh_objects:
        weighted = sum(1 for v in m.data.vertices if len(v.groups) > 0)
        print(f"[rig_mesh] {m.name}: {len(m.data.vertices)} verts, {weighted} weighted")

    # ── Step 6: export ────────────────────────────────────────────────────────
    export_glb(args.output)
    print(f"[rig_mesh] exported rigged GLB to {args.output}")


if __name__ == "__main__":
    main()
