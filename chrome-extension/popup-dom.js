export function getPopupElements() {
  return {
    popupOverlayEl: document.querySelector("#popup-overlay"),
    popupOverlayEyebrowEl: document.querySelector("#popup-overlay-eyebrow"),
    popupOverlayTitleEl: document.querySelector("#popup-overlay-title"),
    popupOverlayMessageEl: document.querySelector("#popup-overlay-message"),
    previewLabelEl: document.querySelector("#preview-label"),
    detectedAppEl: document.querySelector("#detected-app"),
    detectedDeveloperEl: document.querySelector("#detected-developer"),
    adShotStatusEl: document.querySelector("#ad-shot-status"),
    openLocalShotEl: document.querySelector("#open-local-shot"),
    sensorLatestCardEl: document.querySelector("#sensor-latest-card"),
    sensorLatestTitleEl: document.querySelector("#sensor-latest-title"),
    sensorLatestDetailEl: document.querySelector("#sensor-latest-detail"),
    collectButton: document.querySelector("#collect-button"),
    commentCollectButton: document.querySelector("#comment-collect-button"),
    batchCollectButton: document.querySelector("#batch-collect-button"),
    testScrollButton: document.querySelector("#test-scroll-button"),
    resultMessage: document.querySelector("#result-message"),
    appPickerEl: document.querySelector("#app-picker"),
    appPickerLabelEl: document.querySelector("#app-picker-label"),
    appSelectEl: document.querySelector("#app-select"),
    appPickerHintEl: document.querySelector("#app-picker-hint")
  };
}
