import { dismissUpdate, installUpdate, useUpdate } from "../core/update";
import { useView } from "../core/ui";
import { Glass } from "./Glass/Glass";
import { CloseIcon, DownloadIcon } from "./Icons";

/** A small notice next to the rail when a new version is out. */
export function UpdateToast() {
  const u = useUpdate();
  const inSettings = useView() === "settings";
  const working = u.status === "downloading" || u.status === "installing";
  const show = !!u.info && ((u.status === "available" && u.dismissed !== u.info.version) || working) && !inSettings;
  if (!show) return null;

  return (
    <Glass variant="panel" radius={20} className="update-toast" key={u.info!.version}>
      <div className="update-toast-inner">
        <span className="update-toast-icon">
          <DownloadIcon size={17} />
        </span>
        <div className="update-toast-text">
          <b>{working ? (u.status === "installing" ? "Устанавливаем…" : `Скачиваем… ${Math.round(u.progress * 100)}%`) : `Вышла MUSE ${u.info!.version}`}</b>
          <span>{working ? "MUSE перезапустится сама" : `У вас ${u.info!.current}`}</span>
        </div>
        {!working && (
          <>
            <button className="link-button link-button-primary update-toast-go" onClick={installUpdate}>
              Обновить
            </button>
            <button className="update-toast-close" aria-label="Позже" title="Позже" onClick={dismissUpdate}>
              <CloseIcon size={12} />
            </button>
          </>
        )}
      </div>
      {working && (
        <div className="sw-update-bar update-toast-bar">
          <span style={{ transform: `scaleX(${u.progress})` }} />
        </div>
      )}
    </Glass>
  );
}
