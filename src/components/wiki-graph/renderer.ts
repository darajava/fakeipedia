import { graphConnections } from "@/lib/graph-connections";

export type Camera = { x: number; y: number; scale: number };

const vertex = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in uvec2 aIndex;
uniform sampler2D uPrevious;
uniform sampler2D uNext;
uniform highp usampler2D uEdges;
uniform highp usampler2D uHighlighted;
uniform int uTextureWidth;
uniform int uEdgeWidth;
uniform int uEdgeStride;
uniform int uMode;
uniform float uMix;
uniform vec2 uViewport;
uniform vec3 uCamera;
uniform float uDpr;
uniform int uSelected;
uniform int uSavedCount;
uniform bool uDark;
out vec4 vColor;
void main() {
  int node = uMode == 0 ? gl_VertexID : int(aIndex.x);
  bool red = node >= uSavedCount;
  bool connected = false;
  vec2 lineOffset = vec2(0.0);
  if (uMode == 1 || uMode == 2) {
    int index = uMode == 2 ? int(aIndex.x) : gl_InstanceID * uEdgeStride;
    uvec2 edge = texelFetch(uEdges, ivec2(index % uEdgeWidth, index / uEdgeWidth), 0).xy;
    red = int(edge.y) >= uSavedCount;
    connected = int(edge.x) == uSelected || int(edge.y) == uSelected;
    // Triangles give consistent line widths across WebGL implementations.
    bool end = gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5;
    float side = gl_VertexID == 0 || gl_VertexID == 2 || gl_VertexID == 3 ? -1.0 : 1.0;
    node = int(end ? edge.y : edge.x);
    ivec2 aCell = ivec2(int(edge.x) % uTextureWidth, int(edge.x) / uTextureWidth);
    ivec2 bCell = ivec2(int(edge.y) % uTextureWidth, int(edge.y) / uTextureWidth);
    vec2 a = mix(texelFetch(uPrevious, aCell, 0).xy, texelFetch(uNext, aCell, 0).xy, uMix);
    vec2 b = mix(texelFetch(uPrevious, bCell, 0).xy, texelFetch(uNext, bCell, 0).xy, uMix);
    vec2 delta = b - a;
    vec2 normal = vec2(-delta.y, delta.x) / max(length(delta), 0.001);
    lineOffset = normal * side * (connected ? (red ? 0.9 : 1.8) : (red ? 0.4 : 1.2));
  }
  ivec2 cell = ivec2(node % uTextureWidth, node / uTextureWidth);
  if (uMode == 0) connected = texelFetch(uHighlighted, cell, 0).r > 0u;
  if (uMode == 3) connected = node == uSelected;
  vec2 p = mix(texelFetch(uPrevious, cell, 0).xy, texelFetch(uNext, cell, 0).xy, uMix);
  vec2 offset = lineOffset;
  if (uMode == 3) {
    int corner = gl_VertexID % 6;
    bool end = corner == 2 || corner == 3 || corner == 5;
    float side = corner == 0 || corner == 2 || corner == 3 ? -1.0 : 1.0;
    float angle = (float(gl_VertexID / 6) + (end ? 1.0 : 0.0)) / 16.0 * 6.2831853;
    float radius = clamp(15.0 * uCamera.z, 4.0, 14.0);
    offset = vec2(sin(angle), cos(angle)) * (radius + side * 1.2) - vec2(0.0, radius);
  }
  vec2 screen = (p - uCamera.xy) * uCamera.z + offset;
  gl_Position = vec4(screen.x / (uViewport.x * 0.5), -screen.y / (uViewport.y * 0.5), 0.0, 1.0);
  gl_PointSize = (red ? clamp(5.0 + sqrt(uCamera.z) * 2.5, 5.0, 13.0)
    : clamp(8.0 + sqrt(uCamera.z) * 3.0, 8.0, 17.0)) * uDpr;
  if (node == uSelected && uMode == 0) gl_PointSize += 5.0 * uDpr;
  else if (connected && uMode == 0) gl_PointSize += 2.0 * uDpr;
  if (red) {
    vColor = uDark ? vec4(1.0, 0.59, 0.59, uMode == 0 ? 0.62 : 0.18)
      : vec4(0.73, 0.18, 0.18, uMode == 0 ? 0.58 : 0.14);
  } else if (uDark) {
    vColor = uMode == 0 ? (node == uSelected ? vec4(0.85, 0.92, 1.0, 1.0) : vec4(0.55, 0.71, 1.0, 0.95))
      : vec4(0.55, 0.71, 1.0, 0.56);
  } else {
    vColor = uMode == 0 ? (node == uSelected ? vec4(0.10, 0.27, 0.52, 1.0) : vec4(0.22, 0.40, 0.60, 0.92))
      : vec4(0.22, 0.40, 0.60, 0.42);
  }
  if (uSelected >= 0) {
    if (connected) vColor.a = uMode == 0 ? 1.0 : 0.9;
    else vColor.a *= uMode == 0 ? 0.22 : 0.12;
    // Highlighted edges are drawn once, at full detail, above the base edges.
    if (uMode == 1 && connected) vColor.a = 0.0;
  }
}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform int uMode;
in vec4 vColor;
out vec4 outColor;
void main() {
  float alpha = 1.0;
  if (uMode == 0) {
    float d = length(gl_PointCoord - vec2(0.5));
    alpha = 1.0 - smoothstep(0.38, 0.5, d);
    if (alpha <= 0.0) discard;
  }
  outColor = vec4(vColor.rgb, vColor.a * alpha);
}`;

export class GraphRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private textures: WebGLTexture[] = [];
  private edgeTexture: WebGLTexture;
  private highlightTexture: WebGLTexture;
  private highlightBuffer: WebGLBuffer;
  private highlightNodes: Uint8Array;
  private highlightedEdges = 0;
  private selected = -1;
  private buffers: WebGLBuffer[] = [];
  private arrays: WebGLVertexArrayObject[] = [];
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private textureWidth: number;
  private textureHeight: number;
  private padded: Float32Array;
  private previousPositions: Float32Array;
  private nextPositions: Float32Array;
  private changedAt = -Infinity;
  private duration: number;
  private reducedMotion: boolean;
  private edgeVertices: number;
  private selfCount: number;
  private nodeCount: number;
  private edges: Uint32Array;
  simplified = false;
  version = 0;

  constructor(private canvas: HTMLCanvasElement, positions: Float32Array, edges: Uint32Array,
    savedCount: number, selfLinks: Uint32Array, reducedMotion: boolean) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("This browser cannot display the graph. You can still search and open every article below.");
    this.gl = gl;
    this.reducedMotion = reducedMotion;
    this.duration = reducedMotion ? 0 : 120;
    this.nodeCount = positions.length / 2;
    this.previousPositions = positions;
    this.nextPositions = positions;
    this.edgeVertices = edges.length;
    this.edges = edges;
    this.selfCount = selfLinks.length;
    this.textureWidth = Math.min(1024, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.textureHeight = Math.max(1, Math.ceil(this.nodeCount / this.textureWidth));
    if (this.textureHeight > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error("This graph exceeds the graphics capacity of this device.");
    this.padded = new Float32Array(this.textureWidth * this.textureHeight * 2);
    this.highlightNodes = new Uint8Array(this.textureWidth * this.textureHeight);
    const shaders = [this.shader(gl.VERTEX_SHADER, vertex), this.shader(gl.FRAGMENT_SHADER, fragment)];
    const program = gl.createProgram()!;
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Graph renderer:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program); throw new Error("Could not initialize the graph renderer.");
    }
    this.program = program;
    gl.useProgram(program);
    for (const name of ["uPrevious", "uNext", "uEdges", "uHighlighted", "uTextureWidth", "uEdgeWidth", "uEdgeStride", "uMode", "uMix", "uViewport", "uCamera", "uDpr", "uSelected", "uSavedCount", "uDark"]) this.uniforms[name] = gl.getUniformLocation(program, name);
    gl.uniform1i(this.uniforms.uHighlighted, 3);
    gl.uniform1i(this.uniforms.uSavedCount, savedCount);
    gl.uniform1i(this.uniforms.uPrevious, 0);
    gl.uniform1i(this.uniforms.uNext, 1);
    gl.uniform1i(this.uniforms.uTextureWidth, this.textureWidth);
    gl.uniform1i(this.uniforms.uEdges, 2);
    gl.uniform1i(this.uniforms.uEdgeWidth, this.textureWidth);
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!;
      this.textures.push(texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, this.textureWidth, this.textureHeight);
      this.upload(texture, positions);
    }
    this.edgeTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.edgeTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const edgeHeight = Math.max(1, Math.ceil(edges.length / 2 / this.textureWidth));
    if (edgeHeight > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      this.destroy();
      throw new Error("This graph has more links than this device can display. You can still search and open articles.");
    }
    const paddedEdges = new Uint32Array(this.textureWidth * edgeHeight * 2);
    paddedEdges.set(edges);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32UI, this.textureWidth, edgeHeight);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.textureWidth, edgeHeight, gl.RG_INTEGER, gl.UNSIGNED_INT, paddedEdges);
    this.highlightTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.highlightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, this.textureWidth, this.textureHeight);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.textureWidth, this.textureHeight, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.highlightNodes);
    this.makeArray(new Uint32Array(), 0, false);
    this.makeArray(new Uint32Array(), 0, false);
    this.makeArray(new Uint32Array(), 1, true);
    this.highlightBuffer = this.buffers[this.buffers.length - 1];
    this.makeArray(selfLinks, 1, true);
    // Disabled integer attributes need integer defaults too. WebGL otherwise
    // rejects the node and edge passes.
    gl.vertexAttribI4ui(0, 0, 0, 0, 0);
    gl.vertexAttribI4ui(1, 0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (gl.getError() !== gl.NO_ERROR) {
      this.destroy();
      throw new Error("This device could not allocate the graph display. You can still search and open articles.");
    }
  }

  private shader(type: number, source: string) {
    const gl = this.gl, shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("Could not initialize the graph shaders.");
    }
    return shader;
  }

  private makeArray(data: Uint32Array, columns: number, instanced: boolean) {
    const gl = this.gl, array = gl.createVertexArray()!;
    this.arrays.push(array); gl.bindVertexArray(array);
    if (!columns) return;
    const buffer = gl.createBuffer()!;
    this.buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (let i = 0; i < columns; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribIPointer(i, 1, gl.UNSIGNED_INT, columns * 4, i * 4);
      gl.vertexAttribDivisor(i, instanced ? 1 : 0);
    }
  }

  private upload(texture: WebGLTexture, positions: Float32Array) {
    const gl = this.gl;
    this.padded.set(positions);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.textureWidth, this.textureHeight, gl.RG, gl.FLOAT, this.padded);
  }

  update(positions: Float32Array, version: number, duration: number) {
    // Start from the frame actually on screen, even if a faster worker update
    // arrives midway through a transition. Never snap back to an old target.
    const blend = this.mix();
    const previous = new Float32Array(positions.length);
    for (let i = 0; i < previous.length; i++) previous[i] = this.previousPositions[i] + (this.nextPositions[i] - this.previousPositions[i]) * blend;
    this.previousPositions = previous;
    this.nextPositions = positions;
    this.upload(this.textures[0], previous);
    this.upload(this.textures[1], positions);
    this.changedAt = performance.now();
    this.duration = this.reducedMotion ? 0 : Math.min(1000, duration);
    this.version = version;
    return previous.slice();
  }

  mix(now = performance.now()) { return this.duration ? Math.min(1, (now - this.changedAt) / this.duration) : 1; }

  isHighlighted(index: number) { return this.selected < 0 || this.highlightNodes[index] === 1; }

  private select(index: number) {
    if (this.selected === index) return;
    this.selected = index;
    const connected = graphConnections(this.edges, this.nodeCount, index);
    this.highlightNodes.fill(0);
    this.highlightNodes.set(connected.nodes);
    this.highlightedEdges = connected.edges.length;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.highlightTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.textureWidth, this.textureHeight, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.highlightNodes);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, connected.edges, gl.DYNAMIC_DRAW);
  }

  moveNode(index: number, x: number, y: number) {
    const offset = index * 2;
    this.previousPositions[offset] = this.nextPositions[offset] = x;
    this.previousPositions[offset + 1] = this.nextPositions[offset + 1] = y;
    const gl = this.gl, point = new Float32Array([x, y]);
    // Two tiny texture writes move the node and every attached link immediately,
    // without rebuilding geometry or transferring a 100k-node layout per move.
    for (const texture of this.textures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, index % this.textureWidth, Math.floor(index / this.textureWidth), 1, 1, gl.RG, gl.FLOAT, point);
    }
  }

  screenPosition(index: number, camera: Camera, now: number) {
    const mix = this.mix(now), offset = index * 2;
    return [
      (this.previousPositions[offset] + (this.nextPositions[offset] - this.previousPositions[offset]) * mix - camera.x) * camera.scale + this.canvas.clientWidth / 2,
      (this.previousPositions[offset + 1] + (this.nextPositions[offset + 1] - this.previousPositions[offset + 1]) * mix - camera.y) * camera.scale + this.canvas.clientHeight / 2,
    ];
  }

  labelCandidates(camera: Camera, now: number, selected: number, savedCount: number) {
    const candidates = selected >= 0 ? [selected] : [];
    const occupied = new Set<string>();
    const blend = this.mix(now);
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    // Reveal visible red and blue labels as the view zooms in. At overview
    // scale, keep saved-article labels when there are only a few of them.
    const count = camera.scale >= 0.65 || this.nodeCount <= 80 ? this.nodeCount : savedCount <= 80 ? savedCount : 0;
    // Selected label first, then all highlighted neighbours, then background
    // labels. Priority applies before both the candidate cap and collision checks.
    for (let pass = selected >= 0 ? 0 : 1; pass < 2; pass++) {
      const limit = pass === 0 ? this.nodeCount : count;
      for (let index = 0; index < limit && candidates.length < 240; index++) {
        if (index === selected) continue;
        if (selected >= 0 && (this.highlightNodes[index] === 1) !== (pass === 0)) continue;
        const offset = index * 2;
        const x = (this.previousPositions[offset] + (this.nextPositions[offset] - this.previousPositions[offset]) * blend - camera.x) * camera.scale + width / 2;
        const y = (this.previousPositions[offset + 1] + (this.nextPositions[offset + 1] - this.previousPositions[offset + 1]) * blend - camera.y) * camera.scale + height / 2;
        if (x < 0 || y < 0 || x > width || y > height - 30) continue;
        const cell = `${Math.floor(x / 60)},${Math.floor(y / 24)}`;
        if (occupied.has(cell)) continue;
        occupied.add(cell);
        candidates.push(index);
      }
    }
    return candidates;
  }

  private detailStride(camera: Camera, width: number, height: number) {
    const edgeCount = this.edgeVertices / 2;
    if (edgeCount < 20_000) return 1;
    // Estimate on-screen line coverage from a bounded, deterministic sample.
    // Long crossing lines cause expensive overdraw even with only one draw call.
    // Close views naturally restore all edges as fewer intersect the viewport.
    const samples = Math.min(512, edgeCount);
    const diagonal = Math.hypot(width, height);
    let pixels = 0;
    for (let i = 0; i < samples; i++) {
      const edge = Math.floor(i * edgeCount / samples) * 2;
      const a = this.edges[edge] * 2, b = this.edges[edge + 1] * 2;
      const ax = (this.nextPositions[a] - camera.x) * camera.scale;
      const ay = (this.nextPositions[a + 1] - camera.y) * camera.scale;
      const bx = (this.nextPositions[b] - camera.x) * camera.scale;
      const by = (this.nextPositions[b + 1] - camera.y) * camera.scale;
      if (Math.max(ax, bx) < -width / 2 || Math.min(ax, bx) > width / 2 || Math.max(ay, by) < -height / 2 || Math.min(ay, by) > height / 2) continue;
      pixels += Math.min(diagonal, Math.hypot(ax - bx, ay - by));
    }
    const coverage = pixels / samples * edgeCount;
    // Power-of-two detail levels avoid changing the edge sample on every frame.
    return 2 ** Math.ceil(Math.log2(Math.max(1, coverage / 4_000_000)));
  }

  draw(camera: Camera, selected: number, now: number, dark = false) {
    const gl = this.gl;
    this.select(selected);
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    if (dark) gl.clearColor(24 / 255, 26 / 255, 30 / 255, 1);
    else gl.clearColor(0.975, 0.982, 0.987, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    for (let i = 0; i < 2; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.textures[i]); }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.edgeTexture);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.highlightTexture);
    gl.uniform1f(this.uniforms.uMix, this.mix(now));
    gl.uniform2f(this.uniforms.uViewport, width, height);
    gl.uniform3f(this.uniforms.uCamera, camera.x, camera.y, camera.scale);
    gl.uniform1f(this.uniforms.uDpr, dpr);
    gl.uniform1i(this.uniforms.uSelected, selected);
    gl.uniform1i(this.uniforms.uDark, dark ? 1 : 0);
    const stride = this.detailStride(camera, width, height);
    this.simplified = stride > 1;
    gl.uniform1i(this.uniforms.uEdgeStride, stride);
    // The highlight pass includes every incident edge even at overview detail.
    for (const mode of [1, 3, 2, 0]) {
      gl.uniform1i(this.uniforms.uMode, mode); gl.bindVertexArray(this.arrays[mode]);
      if (mode === 0) gl.drawArrays(gl.POINTS, 0, this.nodeCount);
      if (mode === 1) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.ceil(this.edgeVertices / 2 / stride));
      if (mode === 2) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.highlightedEdges);
      if (mode === 3) gl.drawArraysInstanced(gl.TRIANGLES, 0, 16 * 6, this.selfCount);
    }
    return this.mix(now) < 1;
  }

  destroy() {
    const gl = this.gl;
    for (const texture of this.textures) gl.deleteTexture(texture);
    gl.deleteTexture(this.edgeTexture);
    gl.deleteTexture(this.highlightTexture);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    for (const array of this.arrays) gl.deleteVertexArray(array);
    gl.deleteProgram(this.program);
  }
}
