/**
 * 空间计算工具函数
 * 提供距离计算和范围检查功能
 */

/**
 * 3D 坐标点接口
 */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * 2D 坐标点接口（水平面）
 */
export interface Point2D {
  x: number;
  z: number;
}

/**
 * 计算 3D 欧几里得距离
 * @param a 点 A
 * @param b 点 B
 * @returns 两点之间的距离
 */
export function distance3D(a: Point3D, b: Point3D): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2));
}

/**
 * 计算水平距离（忽略 Y 轴）
 * @param a 点 A
 * @param b 点 B
 * @returns 两点在水平面上的距离
 */
export function distanceXZ(a: Point2D, b: Point2D): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.z - b.z, 2));
}

/**
 * 检查点是否在指定半径内
 * @param a 点 A
 * @param b 点 B（中心点）
 * @param radius 半径
 * @returns 如果点 A 在点 B 的半径内返回 true
 */
export function withinRadius(a: Point3D, b: Point3D, radius: number): boolean {
  return distance3D(a, b) <= radius;
}
