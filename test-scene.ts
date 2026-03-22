/**
 * Quick test script: create a water + NPC scene and print the viewer URL.
 * Run with: npx tsx test-scene.ts
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { SceneManager } from "./src/scene/scene-manager.js";
import { SqliteSceneRepo } from "./src/storage/sqlite/scene-repo.js";
import { StubProvider } from "./src/providers/stub/provider.js";
import { SceneProviderRegistry } from "./src/providers/scene-provider-registry.js";
import { NarratorRegistry } from "./src/narrators/narrator-registry.js";
import type { SceneData } from "./src/scene/types.js";

const db = new Database("./dev.db");
db.pragma("journal_mode = WAL");

const repo = new SqliteSceneRepo(db);
const registry = new SceneProviderRegistry([new StubProvider()], "stub");
const narRegistry = new NarratorRegistry([], "none");
const manager = new SceneManager({ current: registry }, { current: narRegistry }, repo);

const sceneData: SceneData = {
  environment: {
    skybox: "clear_day",
    timeOfDay: "noon",
    ambientLight: "warm",
    weather: "clear",
  },
  viewpoints: [
    {
      viewpointId: "vp_shore",
      name: "湖岸视角",
      position: { x: 0, y: 1.7, z: 14 },
      lookAt: { x: 0, y: 0, z: -5 },
    },
    {
      viewpointId: "vp_hill",
      name: "山丘俯瞰",
      position: { x: -12, y: 8, z: 6 },
      lookAt: { x: 2, y: 0, z: -4 },
    },
  ],
  objects: [
    // Ground — covers only the village area, NOT the lake
    {
      objectId: "t_ground",
      name: "村庄草地",
      type: "terrain",
      position: { x: 2, y: 0, z: 8 },
      description: "宽阔的绿色草地",
      interactable: false,
      metadata: { shape: "floor", width: 30, depth: 22 },
    },
    // Lake / water — positioned in front of village, no overlap with floor
    {
      objectId: "t_lake",
      name: "宁静的湖面",
      type: "terrain",
      position: { x: 0, y: -0.05, z: -8 },
      description: "碧绿平静的湖水，倒映着蓝天",
      interactable: false,
      metadata: { shape: "water", width: 32, depth: 20 },
    },
    // Hills background
    {
      objectId: "t_hill_l",
      name: "左侧绿丘",
      type: "terrain",
      position: { x: -16, y: 5, z: -20 },
      description: "连绵起伏的青翠山丘",
      interactable: false,
      metadata: { shape: "hill", width: 14, height: 5 },
    },
    {
      objectId: "t_hill_r",
      name: "右侧山丘",
      type: "terrain",
      position: { x: 18, y: 7, z: -22 },
      description: "高耸的山丘，树木葱郁",
      interactable: false,
      metadata: { shape: "hill", width: 12, height: 7 },
    },
    // Trees — on the village ground, bordering the lake shore
    {
      objectId: "tree_1",
      name: "湖边柳树",
      type: "tree",
      position: { x: -6, y: 0, z: 2 },
      description: "湖边的一棵大树",
      interactable: false,
      metadata: {},
    },
    {
      objectId: "tree_2",
      name: "湖边松树",
      type: "tree",
      position: { x: 10, y: 0, z: 3 },
      description: "挺拔的松树",
      interactable: false,
      metadata: {},
    },
    {
      objectId: "tree_3",
      name: "背景树林",
      type: "tree",
      position: { x: -14, y: 5, z: -18 },
      description: "山丘上的树木",
      interactable: false,
      metadata: {},
    },
    // Village buildings
    {
      objectId: "bld_1",
      name: "渔民小屋",
      type: "building",
      position: { x: -8, y: 0, z: 4 },
      description: "朴素的石墙小屋，屋顶铺着青瓦",
      interactable: true,
      interactionHint: "敲门看看有没有人",
      metadata: {},
    },
    {
      objectId: "bld_2",
      name: "村庄茶馆",
      type: "building",
      position: { x: 8, y: 0, z: 6 },
      description: "古朴的茶馆，飘出阵阵茶香",
      interactable: true,
      interactionHint: "进去喝杯茶",
      metadata: {},
    },
    // NPCs
    {
      objectId: "npc_fisherman",
      name: "老渔民",
      type: "npc",
      position: { x: -2, y: 0, z: 4 },
      description: "一位白发苍苍的老渔民，手持鱼竿坐在湖边",
      interactable: true,
      interactionHint: "和老渔民聊聊",
      metadata: {},
    },
    {
      objectId: "npc_child",
      name: "玩耍的孩子",
      type: "npc",
      position: { x: 4, y: 0, z: 6 },
      description: "一个活泼的小孩，在湖边追逐蝴蝶",
      interactable: true,
      interactionHint: "和孩子打个招呼",
      metadata: {},
    },
    {
      objectId: "npc_woman",
      name: "洗衣的妇人",
      type: "npc",
      position: { x: 6, y: 0, z: 3 },
      description: "一位妇人正在湖边洗衣，哼着小曲",
      interactable: true,
      interactionHint: "和妇人说说话",
      metadata: {},
    },
  ],
};

const scene = await manager.createScene("test-user", "湖边村庄测试场景", "湖边村庄", sceneData);
console.log("\n✅ Scene created!");
console.log(`   sceneId : ${scene.sceneId}`);
console.log(`   Open at : http://localhost:5173/?sceneId=${scene.sceneId}\n`);

db.close();
