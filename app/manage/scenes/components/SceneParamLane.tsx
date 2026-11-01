"use client";
import type { CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { Text } from '@/components/ui/typography';
import type { CompositionInstance } from '@/lib/scene/protocol';
import type { SceneNode } from '@/lib/scene/hierarchy-authoring';
import { sampleChannel, type TransformGroup } from '@/lib/scene/transform-authoring';
import { SceneKeyLane } from './SceneKeyLane';
import { channelsOf, unitFactor } from './timeline-keys';
import { useTimeline } from './timeline-context';

const display = (value: number) => String(Number(value.toFixed(2)));

/** Lanes show values and key timing; parameter editing lives in the inspector. */
export function SceneParamLane({ node, group, depth, label, expanded, onExpand }: {
  node: SceneNode; group: TransformGroup; depth: number; label: string; expanded: boolean; onExpand(): void;
}) {
  const view = useTimeline();
  const channels = channelsOf(group), factor = unitFactor(group);
  const unit = group === 'rotation' ? '°' : group === 'position' ? 'm' : '';
  const style = { '--depth': depth } as CSSProperties;
  return <>
    <div className="scene-track-row" data-param>
      <div className="scene-track-property" style={style}>
        <button type="button" className="scene-param-toggle" aria-expanded={expanded} onClick={onExpand}
          aria-label={view.text(`${expanded ? '收起' : '展开'}${label}的 X/Y/Z`, `${expanded ? 'Collapse' : 'Expand'} ${label} axes`)}>
          <ChevronRight aria-hidden="true" /><span className="truncate">{label}</span>{unit && <span className="text-muted-foreground">{unit}</span>}
        </button>
        {!view.compact && <Text as="span" variant="bodyXs" tone="subdued" className="scene-param-readout">{channels.map(channel => display(sampleChannel(node, channel, view.time) * factor)).join(' / ')}</Text>}
      </div>
      <SceneKeyLane node={node} channels={channels} label={label} />
    </div>
    {expanded && channels.map(channel => {
      const name = `${label} ${channel.slice(-1).toUpperCase()}`;
      return <div className="scene-track-row" data-param data-axis key={channel}>
        <div className="scene-track-property" style={style}><span className="scene-axis-label">{name}</span><Text as="span" variant="bodyXs" tone="subdued" className="scene-param-readout">{display(sampleChannel(node, channel, view.time) * factor)}</Text></div>
        <SceneKeyLane node={node} channels={[channel]} label={name} />
      </div>;
    })}
  </>;
}

export function SceneScalarLane({ node, channel, depth, label }: {
  node: CompositionInstance; channel: 'opacity' | 'volume'; depth: number; label: string;
}) {
  const view = useTimeline();
  return <div className="scene-track-row" data-param data-scalar={channel}>
    <div className="scene-track-property" style={{ '--depth': depth } as CSSProperties}>
      <span className="scene-scalar-label">{label}</span>
      <Text as="span" variant="bodyXs" tone="subdued" className="scene-param-readout">{display(sampleChannel(node, channel, view.time) * 100)}%</Text>
    </div>
    <SceneKeyLane node={node} channels={[channel]} label={label} />
  </div>;
}
