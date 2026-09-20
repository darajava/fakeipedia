"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { graphNodePath } from "@/lib/graph-layout";
import { GraphMotion } from "@/lib/graph-motion";
import { GraphRenderer, type Camera } from "./renderer";
import "./wiki-graph.css";

type Controls = { fit: () => void; zoom: (factor: number) => void; pause: (paused: boolean) => void; focus: (index: number) => void; search: (query: string) => void };
type PointerGesture = {
  request: number; startX: number; startY: number; x: number; y: number;
  worldX: number; worldY: number; appliedX: number; appliedY: number;
  index?: number; neighbours: number[]; offsetX: number; offsetY: number; moved: boolean; released: boolean;
};

export function WikiGraph({ wiki }: { wiki: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLCanvasElement>(null);
  const controls = useRef<Controls | null>(null);
  const nodesRef = useRef<[string, string][]>([]);
  const pathsRef = useRef<string[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [nodes, setNodes] = useState<[string, string][]>([]);
  const queryRef = useRef("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [status, setStatus] = useState("Loading articles…");
  const [counts, setCounts] = useState<{ nodes: number; saved: number; edges: number; missing: number } | null>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [settled, setSettled] = useState(false);
  const [simplified, setSimplified] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const labels = labelsRef.current;
    const labelContext = labels?.getContext("2d");
    const worker = new Worker(new URL("./graph.worker.ts", import.meta.url));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dark = document.documentElement.dataset.theme === "dark";
    let renderer: GraphRenderer | undefined;
    let positions = new Float32Array();
    let bounds = [-100, -100, 100, 100];
    let camera: Camera = { x: 0, y: 0, scale: 1 };
    let target = { ...camera };
    let frame = 0, lastFrame = 0, selected = -1;
    let hoverRequest = 0, lastPick = 0;
    let userPaused = false;
    let disposed = false;
    let wasSimplified = false;
    let gestures = false, travel = 0;
    let gesture: PointerGesture | undefined;
    let motion: GraphMotion | undefined;
    let motionActive = false, lastMotionSync = 0;
    let savedCount = 0;
    const pinned = new Map<number, { x: number; y: number }>();
    const pointers = new Map<number, { x: number; y: number }>();

    function wake() { if (!frame && !document.hidden && !disposed) frame = requestAnimationFrame(draw); }
    function syncMotion() {
      if (!motion) return;
      worker.postMessage({ type: "motion", points: motion.bodies.map(({ index, x, y }) => ({ index, x, y })) });
      lastMotionSync = performance.now();
    }
    function draw(now: number) {
      frame = 0;
      const elapsed = Math.min(64, now - (lastFrame || now - 16));
      const amount = reducedMotion ? 1 : 1 - Math.exp(-elapsed / 65);
      lastFrame = now;
      camera.x += (target.x - camera.x) * amount;
      camera.y += (target.y - camera.y) * amount;
      camera.scale += (target.scale - camera.scale) * amount;
      const moving = Math.abs(camera.x - target.x) * camera.scale > 0.05 || Math.abs(camera.y - target.y) * camera.scale > 0.05 || Math.abs(camera.scale - target.scale) > 0.00001;
      if (!moving) camera = { ...target };
      if (motion && motionActive) {
        motionActive = motion.step(elapsed, camera.scale);
        for (const { index, x, y } of motion.bodies) {
          pinned.set(index, { x, y });
          renderer?.moveNode(index, x, y);
          positions[index * 2] = x; positions[index * 2 + 1] = y;
        }
        if (now - lastMotionSync > 50 || !motionActive) syncMotion();
        if (!motionActive) worker.postMessage({ type: "drag-end" });
      }
      const morphing = renderer?.draw(camera, selected, now, dark);
      if (renderer && renderer.simplified !== wasSimplified) { wasSimplified = renderer.simplified; setSimplified(wasSimplified); }
      if (renderer && labels && labelContext) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (labels.width !== canvas!.width || labels.height !== canvas!.height) { labels.width = canvas!.width; labels.height = canvas!.height; }
        labelContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        labelContext.clearRect(0, 0, canvas!.clientWidth, canvas!.clientHeight);
        // Only measure a bounded set of visible labels, regardless of wiki size.
        const indices = renderer.labelCandidates(camera, now, selected, savedCount);
        const occupied: number[][] = [];
        for (const index of indices) {
          const [x, y] = renderer.screenPosition(index, camera, now);
          if (x < 0 || y < 0 || x > canvas!.clientWidth || y > canvas!.clientHeight) continue;
          const title = nodesRef.current[index][1];
          const text = title.length > 34 ? title.slice(0, 32) + "…" : title;
          labelContext.font = index === selected ? "bold 12px Arial, sans-serif" : "12px Arial, sans-serif";
          const width = labelContext.measureText(text).width;
          const left = Math.max(5, Math.min(canvas!.clientWidth - width - 9, x - width / 2));
          const top = Math.max(5, y + 25);
          if (occupied.some(([ox, oy, ow]) => Math.abs(oy - top) < 19 && left < ox + ow + 8 && left + width + 8 > ox)) continue;
          occupied.push([left, top, width]);
          labelContext.globalAlpha = renderer.isHighlighted(index) ? 1 : 0.22;
          labelContext.fillStyle = dark ? "rgba(24, 26, 30, 0.92)" : "rgba(249, 250, 252, 0.92)";
          labelContext.fillRect(left - 3, top - 12, width + 6, 17);
          labelContext.fillStyle = index >= savedCount ? (dark ? "#ff9696" : "#ba2e2e") : (dark ? "#d5e3f5" : "#30475f");
          labelContext.fillText(text, left, top);
        }
        labelContext.globalAlpha = 1;
      }
      if (moving || morphing || motionActive) wake();
    }
    function fit(immediate = false) {
      target = { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2,
        scale: Math.max(0.002, Math.min(2, (canvas!.clientWidth - 72) / Math.max(1, bounds[2] - bounds[0]), (canvas!.clientHeight - 72) / Math.max(1, bounds[3] - bounds[1]))) };
      if (immediate) camera = { ...target };
      wake();
    }
    function zoom(factor: number, x = 0, y = 0) {
      const scale = Math.max(0.002, Math.min(15, target.scale * factor));
      target.x += x / target.scale - x / scale;
      target.y += y / target.scale - y / scale;
      target.scale = scale;
      wake();
    }
    function pick(clientX: number, clientY: number, press = false) {
      if (!renderer) return -1;
      const rect = canvas!.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      // Pick the positions actually on screen, including coasting nodes.
      if (motionActive) syncMotion();
      worker.postMessage({ type: "pick", x: camera.x + (x - rect.width / 2) / camera.scale,
        y: camera.y + (y - rect.height / 2) / camera.scale, radius: Math.max(6, Math.min(17, 8 + Math.sqrt(camera.scale) * 3) / 2 + 2) / camera.scale,
        screenX: x, screenY: y, press, version: renderer.version, mix: renderer.mix(), request: ++hoverRequest });
      return hoverRequest;
    }
    function applyGesture() {
      if (!gesture || gesture.index === undefined || travel < 5) return;
      if (gesture.index >= 0) {
        const rect = canvas!.getBoundingClientRect();
        const x = camera.x + (gesture.x - rect.left - rect.width / 2) / camera.scale + gesture.offsetX;
        const y = camera.y + (gesture.y - rect.top - rect.height / 2) / camera.scale + gesture.offsetY;
        if (!gesture.moved) {
          syncMotion();
          const point = (index: number) => {
            const screen = renderer!.screenPosition(index, camera, performance.now());
            return { index, x: camera.x + (screen[0] - rect.width / 2) / camera.scale, y: camera.y + (screen[1] - rect.height / 2) / camera.scale };
          };
          motion = new GraphMotion(point(gesture.index), gesture.neighbours.map(point), performance.now(), camera.scale, reducedMotion);
        }
        motion!.move(x, y, performance.now());
        motionActive = true;
        selected = gesture.index;
        gesture.moved = true;
      } else {
        target.x -= (gesture.x - gesture.appliedX) / target.scale;
        target.y -= (gesture.y - gesture.appliedY) / target.scale;
      }
      gesture.appliedX = gesture.x; gesture.appliedY = gesture.y;
      wake();
    }
    function finishGesture() {
      if (!gesture || gesture.index === undefined) return;
      if (gesture.moved) { motion?.release(performance.now()); wake(); }
      else if (travel < 5 && gesture.index >= 0) router.push(pathsRef.current[gesture.index]);
      gesture = undefined;
    }
    worker.onmessage = ({ data }) => {
      if (disposed) return;
      if (data.type === "progress") setStatus(`Loading articles… ${data.count.toLocaleString()} read`);
      if (data.type === "error") { setError(data.message); setStatus(""); }
      if (data.type === "ready") {
        nodesRef.current = data.nodes;
        savedCount = data.savedCount;
        pathsRef.current = data.nodes.map((_: unknown, index: number) => graphNodePath(wiki, data.nodes, index, savedCount, data.sources));
        setPaths(pathsRef.current);
        setNodes(data.nodes);
        positions = data.positions;
        bounds = data.bounds;
        setCounts({ nodes: data.nodes.length, saved: savedCount, edges: data.edges.length / 2, missing: data.missingCount });
        if (!data.nodes.length) setSettled(true);
        setStatus(data.nodes.length ? "Arranging articles…" : "There are no articles in this wiki yet.");
        setMatches(data.nodes.slice(0, 6).map((_: unknown, index: number) => index));
        try {
          renderer = new GraphRenderer(canvas, positions, data.edges, savedCount, data.selfLinks, reducedMotion);
          fit(true);
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not display the graph."); }
        if (queryRef.current) worker.postMessage({ type: "search", query: queryRef.current });
      }
      if (data.type === "positions") {
        positions = data.positions;
        // An already queued layout snapshot must not pull a dragged node back.
        for (const [index, point] of pinned) { positions[index * 2] = point.x; positions[index * 2 + 1] = point.y; }
        bounds = data.bounds;
        const previous = renderer?.update(positions, data.version, data.duration);
        if (previous) worker.postMessage({ type: "rendered", version: data.version, previous }, [previous.buffer]);
        wake();
        if (data.done) { setSettled(true); setStatus(""); }
      }
      if (data.type === "bounds") bounds = data.bounds;
      if (data.type === "picked" && data.press && gesture && gesture.request === data.request) {
        gesture.index = data.index;
        gesture.neighbours = data.neighbours;
        gesture.offsetX = data.nodeX - gesture.worldX;
        gesture.offsetY = data.nodeY - gesture.worldY;
        applyGesture();
        if (gesture?.released) finishGesture();
      }
      if (data.type === "picked" && !data.press && data.request === hoverRequest && !pointers.size && !gesture) {
        const node = nodesRef.current[data.index];
        selected = data.index;
        canvas.style.cursor = node ? "pointer" : "grab";
        wake();
      }
      if (data.type === "matches" && data.query === queryRef.current) setMatches(data.matches);
    };
    worker.onerror = () => { setError("The graph could not load. Please try again."); setStatus(""); };
    controls.current = {
      fit: () => fit(), zoom,
      pause(value) { userPaused = value; worker.postMessage({ type: "pause", paused: value || document.hidden }); },
      focus(index) {
        target = { x: positions[index * 2], y: positions[index * 2 + 1], scale: 2.5 };
        selected = index; wake(); canvas.focus();
      },
      search(value) { worker.postMessage({ type: "search", query: value }); },
    };
    function pointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      canvas!.setPointerCapture(event.pointerId);
      if (!pointers.size) {
        travel = 0; gestures = false;
        target = { ...camera };
        const rect = canvas!.getBoundingClientRect();
        gesture = {
          request: pick(event.clientX, event.clientY, true), startX: event.clientX, startY: event.clientY,
          x: event.clientX, y: event.clientY, appliedX: event.clientX, appliedY: event.clientY,
          worldX: camera.x + (event.clientX - rect.left - rect.width / 2) / camera.scale,
          worldY: camera.y + (event.clientY - rect.top - rect.height / 2) / camera.scale,
          neighbours: [], offsetX: 0, offsetY: 0, moved: false, released: false, index: renderer ? undefined : -1,
        };
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size > 1) {
        gestures = true;
        if (gesture?.moved) { motion?.release(performance.now(), true); wake(); }
        gesture = undefined;
      }
      canvas!.style.cursor = "grabbing";
      hoverRequest++;
    }
    function pointerMove(event: PointerEvent) {
      const previous = pointers.get(event.pointerId);
      if (!previous) {
        if (performance.now() - lastPick > 50) { lastPick = performance.now(); pick(event.clientX, event.clientY, false); }
        return;
      }
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      travel += Math.hypot(dx, dy);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture && pointers.size === 1) {
        gesture.x = event.clientX; gesture.y = event.clientY;
        applyGesture();
        return;
      }
      if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)![1];
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const newDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        const rect = canvas!.getBoundingClientRect();
        zoom(newDistance / Math.max(1, oldDistance), (event.clientX + other.x) / 2 - rect.left - rect.width / 2, (event.clientY + other.y) / 2 - rect.top - rect.height / 2);
        target.x -= dx / (2 * target.scale); target.y -= dy / (2 * target.scale);
      } else { target.x -= dx / target.scale; target.y -= dy / target.scale; }
      wake();
    }
    function pointerUp(event: PointerEvent) {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
      canvas!.style.cursor = "grab";
      if (gesture && !gestures) {
        if (event.type !== "pointerup") {
          if (gesture.moved) { motion?.release(performance.now(), true); wake(); }
          gesture = undefined;
        } else {
          travel = Math.max(travel, Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY));
          gesture.x = event.clientX; gesture.y = event.clientY; gesture.released = true;
          applyGesture(); finishGesture();
        }
      }
    }
    function pointerLeave() { if (!pointers.size) { hoverRequest++; selected = -1; wake(); } }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(Math.exp(-Math.max(-150, Math.min(150, delta)) * 0.003), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    }
    function keyDown(event: KeyboardEvent) {
      if (["+", "=", "-", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) event.preventDefault();
      if (event.key === "+" || event.key === "=") zoom(1.4);
      if (event.key === "-") zoom(1 / 1.4);
      if (event.key === "Home") fit();
      if (event.key === "ArrowLeft") target.x -= 80 / target.scale;
      if (event.key === "ArrowRight") target.x += 80 / target.scale;
      if (event.key === "ArrowUp") target.y -= 80 / target.scale;
      if (event.key === "ArrowDown") target.y += 80 / target.scale;
      if (event.key === "Enter" && selected >= 0) router.push(pathsRef.current[selected]);
      wake();
    }
    function visibility() {
      worker.postMessage({ type: "pause", paused: userPaused || document.hidden });
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake();
    }
    function contextLost(event: Event) {
      event.preventDefault();
      setError("The graphics connection was interrupted. Reload the graph to continue.");
      worker.postMessage({ type: "pause", paused: true });
      cancelAnimationFrame(frame); frame = 0;
    }
    const themeObserver = new MutationObserver(() => {
      dark = document.documentElement.dataset.theme === "dark";
      wake();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const resize = new ResizeObserver(wake);
    resize.observe(canvas);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("lostpointercapture", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("keydown", keyDown);
    canvas.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", visibility);
    worker.postMessage({ type: "load", wiki, reducedMotion });
    visibility();
    return () => {
      disposed = true; controls.current = null;
      themeObserver.disconnect();
      worker.terminate(); renderer?.destroy(); cancelAnimationFrame(frame); resize.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("lostpointercapture", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("keydown", keyDown);
      canvas.removeEventListener("webglcontextlost", contextLost);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [wiki, retry, router]);

  return (
    <section className="article-graph" aria-label="Article graph">
      <div className="graph-toolbar">
        <div className="graph-counts" aria-live="polite">
          {counts ? <><strong>{counts.saved.toLocaleString()}</strong> articles <span>·</span> {(counts.nodes - counts.saved).toLocaleString()} unwritten <span>·</span> {(counts.edges - counts.missing).toLocaleString()} blue links <span>·</span> {counts.missing.toLocaleString()} red links</> : "Reading this wiki’s links"}
        </div>
        <div className="graph-controls">
          <button onClick={() => controls.current?.zoom(1.5)} aria-label="Zoom in" disabled={!counts}>+</button>
          <button onClick={() => controls.current?.zoom(1 / 1.5)} aria-label="Zoom out" disabled={!counts}>−</button>
          <button onClick={() => controls.current?.fit()} disabled={!counts}>Fit all</button>
          <button disabled={!counts || settled} aria-pressed={paused} onClick={() => { setPaused(!paused); controls.current?.pause(!paused); }}>{settled ? "Layout settled" : paused ? "Resume layout" : "Pause layout"}</button>
        </div>
      </div>
      <div className="graph-body">
        <div className="graph-stage">
          <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive article graph. Blue nodes are saved articles; red nodes are unwritten articles. Drag a node to move it, drag the background to pan, scroll or pinch to zoom. Click a blue node to read or a red node to generate its article. Keyboard: arrow keys to pan, plus and minus to zoom, Home to fit all, Enter to open the selected node. Search the article list to focus or open a page." />
          <canvas ref={labelsRef} className="graph-labels" aria-hidden="true" />
          {status && !error && <p className={`graph-status${counts?.nodes ? " graph-status-small" : ""}`} role="status">{paused && counts ? "Layout paused" : status}</p>}
          {error && <div className="graph-error" role="alert"><p>{error}</p><button onClick={() => { setError(""); setCounts(null); setStatus("Loading articles…"); setPaused(false); setSettled(false); setSimplified(false); setMatches([]); setRetry(retry + 1); }}>Reload graph</button></div>}
          <p className="graph-hint">{simplified ? "All nodes shown · Zoom in for more link detail" : "Drag dots to move · Click blue to read, red to generate"}</p>
        </div>
        <aside className="graph-search" aria-label="Find an article">
          <label htmlFor="graph-search">Find an article</label>
          <input id="graph-search" type="search" placeholder="Search this wiki…" value={query} disabled={!counts} onChange={(event) => {
            setQuery(event.target.value); queryRef.current = event.target.value;
            controls.current?.search(event.target.value);
          }} />
          <p className="graph-search-caption">{query ? "Matching articles" : "Explore an article"}</p>
          <ul className="graph-results">
            {matches.map((index) => {
              const node = nodes[index];
              const unwritten = counts !== null && index >= counts.saved;
              return node && <li key={index}><Link href={paths[index]} prefetch={false} className={unwritten ? "wiki-link-missing" : undefined}>{node[1]}{unwritten && <span className="graph-unwritten-label">Unwritten</span>}</Link><button aria-label={`Find ${node[1]} on the graph`} title="Show on graph" onClick={() => controls.current?.focus(index)}>⌖</button></li>;
            })}
          </ul>
          {query && counts && !matches.length && <p role="status">No matching articles.</p>}
          <div className="graph-legend"><p><i className="graph-node-key" /> Saved article</p><p><i className="graph-red-key" /> Unwritten article</p><p><i className="graph-link-key" /> Article link</p></div>
          <p className="graph-explanation">Blue dots are saved articles. Red dots are unwritten articles, shared by all pages that link to them. Click a red dot to generate its article.</p>
        </aside>
      </div>
    </section>
  );
}
