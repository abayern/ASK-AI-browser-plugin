/**
 * 隐私与数据边界说明。
 *
 * 措辞刻意保持诚实：不宣称「绝对安全」，也不把卸载描述成
 * 能够保证彻底擦除所有本地数据。
 */
export function PrivacyNotice() {
  return (
    <div className="privacy">
      <dl className="privacy__list">
        <div className="privacy__item">
          <dt>API Key 保存在哪里</dt>
          <dd>浏览器扩展的本地存储（storage.local）中，仅本机可读。</dd>
        </div>

        <div className="privacy__item">
          <dt>请求发往哪里</dt>
          <dd>
            直接发往你配置的服务商地址，不经过本产品的自有后端。
            本扩展没有账号系统、云端历史，也不做遥测。
          </dd>
        </div>

        <div className="privacy__item">
          <dt>服务商会收到什么</dt>
          <dd>
            处理请求所需的文本与上下文，包括你选中的网页文字和你的提问。
            这些内容如何处理，取决于该服务商自己的隐私政策。
          </dd>
        </div>

        <div className="privacy__item">
          <dt>你的选中文字</dt>
          <dd>
            只有当你明确点击提问后才会发送，不会自动上传整页内容。
            扩展不会执行网页中的代码，也不会把网页里的指令当作系统指令。
          </dd>
        </div>

        <div className="privacy__item">
          <dt>安全边界</dt>
          <dd>
            本地扩展存储不等于加密的密钥保险箱。浏览器本身、其它扩展、
            被篡改的扩展代码，或拥有本机扩展执行权限的人都可能接触到凭证。
          </dd>
        </div>

        <div className="privacy__item">
          <dt>卸载之后</dt>
          <dd>
            卸载扩展通常会移除其本地数据，但这不能被理解为在任何情况下都保证
            彻底擦除（例如系统备份、磁盘残留）。
          </dd>
        </div>
      </dl>
    </div>
  );
}
