import type { ReactNode } from 'react';

interface SectionProps {
  /** 页边注式的小标签，等宽字体，作为区块序号/类别。 */
  label: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * 设置页的区块容器。
 *
 * 结构上使用「页边标签 + 细线」而不是层层卡片，
 * 因此视觉重心留给内容本身。
 */
export function Section({ label, title, description, children }: SectionProps) {
  return (
    <section className="panel">
      <div className="panel__label">{label}</div>
      <h2 className="panel__title">{title}</h2>
      {description ? <p className="panel__desc">{description}</p> : null}
      <div className="panel__body">{children}</div>
    </section>
  );
}
