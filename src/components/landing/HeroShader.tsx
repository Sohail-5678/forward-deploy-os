"use client";
import { useEffect, useRef } from "react";

/*
 * Iridescent hero background: domain-warped noise in the three brand colors,
 * drawn with raw WebGL at reduced resolution and capped at 30 fps. It pauses
 * when off screen or when the tab is hidden, and draws a single still frame
 * under prefers-reduced-motion. If WebGL is unavailable the CSS nebula behind
 * it shows instead.
 */

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec2 m;
const vec3 AMETHYST=vec3(0.231,0.039,0.420);
const vec3 VIOLET=vec3(0.431,0.169,0.816);
const vec3 LILAC=vec3(0.722,0.545,1.0);
const vec3 CYAN=vec3(0.0,0.898,1.0);
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;
  vec2 p=(gl_FragCoord.xy-.5*r)/r.y;
  p+=m*.08;
  float tt=t*.035;
  vec2 q=vec2(fbm(p*1.3+tt),fbm(p*1.3-tt+3.1));
  vec2 w=vec2(fbm(p*1.7+2.*q+vec2(1.7,9.2)+tt*1.4),fbm(p*1.7+2.*q+vec2(8.3,2.8)-tt));
  float f=fbm(p*1.5+2.3*w);
  float band=sin(f*10.+w.x*5.-tt*7.)*.5+.5;
  vec3 col=mix(vec3(.012,.008,.02),AMETHYST,smoothstep(.25,.85,f));
  col=mix(col,VIOLET,smoothstep(.62,1.,f*(.6+w.y)));
  col+=LILAC*pow(band,10.)*smoothstep(.5,.9,f)*.35;
  col+=CYAN*pow(1.-abs(band*2.-1.),12.)*smoothstep(.45,.95,f)*.55;
  float v=smoothstep(1.35,.15,length(p*vec2(.85,1.15)));
  col*=v;
  col*=smoothstep(-.05,.55,uv.y);
  gl_FragColor=vec4(col,1.);
}`;

export function HeroShader({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // alpha: true keeps the canvas transparent (CSS nebula visible) until the first frame is drawn.
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "low-power", preserveDrawingBuffer: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, "r");
    const uT = gl.getUniformLocation(prog, "t");
    const uM = gl.getUniformLocation(prog, "m");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scale = 0.5;
    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const hgt = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== hgt) {
        canvas.width = w;
        canvas.height = hgt;
        gl.viewport(0, 0, w, hgt);
      }
    };
    // Pointer parallax eases toward the target instead of jumping (decorative only).
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    const draw = (time: number) => {
      resize();
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      gl.uniform2f(uR, canvas.width, canvas.height);
      gl.uniform1f(uT, time / 1000 + 12);
      gl.uniform2f(uM, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (reduced) {
      draw(0);
      const ro = new ResizeObserver(() => draw(0));
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    // Paint the first frame now, without waiting for the first animation frame.
    draw(performance.now());
    let raf = 0;
    let last = 0;
    let visible = true;
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden || time - last < 33) return;
      last = time;
      draw(time);
    };
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      // No loseContext() here: React may re-run this effect on the same canvas,
      // and a lost context cannot be recovered. The browser frees it with the canvas.
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
