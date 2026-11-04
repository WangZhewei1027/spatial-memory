const positions = Buffer.from(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]).buffer);
export function modelGltf() {
  return {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: positions.length, uri: `data:application/octet-stream;base64,${positions.toString("base64")}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0 } }],
  };
}

export function modelGlb(color: [number, number, number, number] = [1, 0, 0, 1]): Buffer {
  const document = modelGltf();
  document.materials[0].pbrMetallicRoughness.baseColorFactor = color;
  Reflect.deleteProperty(document.buffers[0], "uri");
  const json = Buffer.from(JSON.stringify(document));
  const chunk = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(chunk);
  const header = Buffer.alloc(20);
  header.write("glTF"); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + chunk.length + positions.length, 8);
  header.writeUInt32LE(chunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binary = Buffer.alloc(8); binary.writeUInt32LE(positions.length); binary.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, chunk, binary, positions]);
}

/** Same triangle encoded once with Three's bundled Draco encoder (POSITION 14
 * bits, speed 5). Embedded here so the decoder regression needs no network. */
export function dracoModelGltf(): Buffer {
  const encoded = "RFJBQ08CAgEBAAAAAwEAAQAAAQf/AREB/wAAAQAJAwAAAgEBAQAPA1UVL60qAwRwgen/AwAA4P8XAAAAAAAAAP8/AAAAAIC/AACAvwAAAAAAAABADg==";
  const document = modelGltf();
  Reflect.deleteProperty(document.accessors[0], "bufferView");
  document.buffers[0] = { byteLength: 85, uri: `data:application/octet-stream;base64,${encoded}` };
  document.bufferViews[0].byteLength = 85;
  return Buffer.from(JSON.stringify({
    ...document, extensionsRequired: ["KHR_draco_mesh_compression"], extensionsUsed: ["KHR_draco_mesh_compression"],
    meshes: [{ primitives: [{
      ...document.meshes[0].primitives[0],
      extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
    }] }],
  }));
}

/** Same triangle encoded with MeshoptEncoder.encodeGltfBuffer(positions, 3,
 * 12, 'ATTRIBUTES'). The extension's optional fallback buffer is deliberately
 * absent, so this fixture proves the bundled decoder is actually used. */
export function meshoptModelGltf(): Buffer {
  const encoded = "oAAAAQwAAAD/ATwAAAD/fQAAAAEMAAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgL8AAIC/AAAAAA==";
  return Buffer.from(JSON.stringify({
    ...modelGltf(), extensionsRequired: ["EXT_meshopt_compression"], extensionsUsed: ["EXT_meshopt_compression"],
    buffers: [{ byteLength: 61, uri: `data:application/octet-stream;base64,${encoded}` }, { byteLength: 36 }],
    bufferViews: [{ buffer: 1, byteOffset: 0, byteLength: 36, byteStride: 12, extensions: {
      EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 61, byteStride: 12, count: 3, mode: "ATTRIBUTES" },
    } }],
  }));
}
