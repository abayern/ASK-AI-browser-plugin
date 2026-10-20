import { useState } from 'react';

interface PanelSettingsProps {
  pushPanelContent: boolean;
  pending: boolean;
  onSave: (pushPanelContent: boolean) => Promise<boolean>;
}

/**
 * 面板显示方式设置。
 *
 * 「挤压式」能真正避免面板遮挡网页内容，但它会改动网页布局，
 * 因此默认关闭、并由用户显式开启，同时把代价写清楚。
 */
export function PanelSettings({ pushPanelContent, pending, onSave }: PanelSettingsProps) {
  const [enabled, setEnabled] = useState(pushPanelContent);

  async function handleToggle(next: boolean) {
    setEnabled(next);
    const saved = await onSave(next);
    if (!saved) setEnabled(!next);
  }

  return (
    <div className="form">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(event) => void handleToggle(event.target.checked)}
        />
        <span>挤压式停靠：让页面右侧让出空间，面板不再遮住内容</span>
      </label>

      <p className="field__hint">
        关闭时面板是浮层，会盖住网页右侧一部分内容，可点面板上的「收起」让开。
        开启后网页内容整体左移，面板停靠在空白处；
        个别网站（固定定位的导航栏、全宽画布等）可能出现布局错位，遇到时可随时关掉。
      </p>
    </div>
  );
}
