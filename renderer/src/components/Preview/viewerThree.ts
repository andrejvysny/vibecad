import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import type { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";

type SsaoCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export function disposeMaterial(
  material: THREE.Material | THREE.Material[],
): void {
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

export function studioEnvironment(
  renderer: THREE.WebGLRenderer,
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

export function updateOrthographicCamera(
  camera: THREE.OrthographicCamera,
  halfHeight: number,
  viewport: { width: number; height: number },
): void {
  const aspect = viewport.width / viewport.height;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

export function fitShadowCamera(
  light: THREE.DirectionalLight,
  radius: number,
): void {
  const cam = light.shadow.camera;
  const extent = Math.max(radius * 1.35, 1);
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = Math.max(radius * 0.1, 0.01);
  cam.far = radius * 7.5;
  cam.updateProjectionMatrix();
}

export function refreshSsaoCamera(
  renderPass: RenderPass,
  ssaoPass: SSAOPass,
  camera: SsaoCamera,
): void {
  renderPass.camera = camera;
  ssaoPass.camera = camera;
  setUniform(ssaoPass.ssaoMaterial, "cameraNear", camera.near);
  setUniform(ssaoPass.ssaoMaterial, "cameraFar", camera.far);
  setUniform(ssaoPass.depthRenderMaterial, "cameraNear", camera.near);
  setUniform(ssaoPass.depthRenderMaterial, "cameraFar", camera.far);
  copyMatrix(ssaoPass.ssaoMaterial, "cameraProjectionMatrix", camera.projectionMatrix);
  copyMatrix(ssaoPass.ssaoMaterial, "cameraInverseProjectionMatrix", camera.projectionMatrixInverse);
}

function setUniform(
  material: THREE.ShaderMaterial,
  name: string,
  value: number,
): void {
  const uniform = material.uniforms[name];
  if (uniform) uniform.value = value;
}

function copyMatrix(
  material: THREE.ShaderMaterial,
  name: string,
  value: THREE.Matrix4,
): void {
  const uniform = material.uniforms[name];
  if (uniform?.value instanceof THREE.Matrix4) uniform.value.copy(value);
}
