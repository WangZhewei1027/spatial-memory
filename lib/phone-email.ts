// 手机号账号以虚拟邮箱存储；域名是账号的持久化标识。
// 改名时通过 20261101000000_spatial_memory_identity.sql 同步迁移既有账号。
// 13800138000 → 13800138000@phone.spatialmemory.local
// 该域名只是存储实现细节，任何 UI 都不应把它展示给用户——
// 展示时一律用 displayAccount() 还原成手机号。
// 纯函数、无依赖，Client / Server 均可导入。

export const PHONE_EMAIL_DOMAIN = "phone.spatialmemory.local";

const PHONE_EMAIL_SUFFIX = `@${PHONE_EMAIL_DOMAIN}`;

/** 判断一个邮箱是否为手机号对应的虚拟邮箱 */
export function isPhoneEmail(email?: string | null): boolean {
  return !!email && email.toLowerCase().endsWith(PHONE_EMAIL_SUFFIX);
}

/**
 * 把账号标识转成给用户看的形式：
 * 虚拟邮箱 → 手机号（去掉域名部分），普通邮箱原样返回。
 */
export function displayAccount(email: string): string;
export function displayAccount(
  email: string | null | undefined,
): string | null;
export function displayAccount(
  email: string | null | undefined,
): string | null {
  if (!email) return email ?? null;
  if (isPhoneEmail(email)) return email.slice(0, -PHONE_EMAIL_SUFFIX.length);
  return email;
}
