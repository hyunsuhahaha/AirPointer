import type { ReactNode } from "react";
import { Browser, CaretDown, Check, CircleNotch, Copy, Cpu, Desktop, FolderOpen, FolderSimple, HardDrives, Minus, Monitor, Network, Plug, SpeakerHigh, Square, Usb, Warning, X } from "@phosphor-icons/react";
import * as vm from "@/lib/usage-example-vm";
import { Caption, ClaudyChat, Keycaps, PipFrame, Pointer, ShutterFlash, StickCard, box } from "./shared";
import type { ChatItem } from "./shared";
import styles from "./vm-example.module.css";

// Example 02: the VM that won't start. The Box VM windows follow the layout
// of a typical desktop VM manager; names and icons are our own.

const TAB_ICONS = [Monitor, Cpu, Desktop, HardDrives, SpeakerHigh, Plug, Usb, FolderSimple, Network, Browser];
const TAB_FIELDS: [string, string][][] = [
  [["VM 이름", vm.VM_NAME], ["OS", "Linux"], ["OS 버전", "Ubuntu (64-bit)"]],
  [["기본 메모리", "4096 MB"], ["프로세서", "2"], ["부팅 순서", "하드 디스크, 광 디스크"]],
  [["비디오 메모리", "128 MB"], ["그래픽 컨트롤러", "VMSVGA"], ["원격 디스플레이", "사용 안 함"]],
  [["컨트롤러", "SATA"], ["SATA 포트 0", `${vm.VM_NAME}.vdi (25 GB)`], ["광학 드라이브", "비어 있음"]],
  [["호스트 드라이버", "Default"], ["컨트롤러", "ICH AC97"], ["오디오 출력", "사용"]],
  [["포트 1", "사용 안 함"], ["포트 모드", "연결 안 됨"], ["경로", "-"]],
  [["USB 컨트롤러", "OHCI"], ["장치 필터", "0 (0개 활성화됨)"], ["", ""]],
  [["공유 폴더", "1"], ["이름", "project"], ["자동 마운트", "예"]],
  [],
  [["메뉴 바", "표시"], ["상태 표시줄", "표시"], ["미니 도구 모음", "전체 화면에서 표시"]],
];
const BOOT_LINES = ["Box VM BIOS v7.1", "Booting from Hard Disk...", "[  OK  ] Started Network Manager.", "[  OK  ] Reached target Multi-User System.", "Ubuntu 24.04 LTS ubuntu-dev tty1", "ubuntu-dev login: _"];

// A tiny screenshot of the settings window, used for pasted captures and
// the evidence the AI points at.
function SettingsThumb({ tab, highlight = false }: { tab: number; highlight?: boolean }) {
  return <svg viewBox="0 0 160 100" aria-hidden="true">
    <rect width="160" height="100" fill="#f4f5f7" />
    <rect width="160" height="10" fill="#dfe3ea" />
    {vm.SETTINGS_TABS.map((_, index) => <rect key={index} x="4" y={16 + index * 8} width="44" height="6" rx="1" fill={index === tab ? "#1f6fd1" : "#cfd5de"} />)}
    <rect x="56" y="16" width="98" height="78" rx="3" fill="#fff" stroke="#d6dbe3" />
    <rect x="62" y="22" width="40" height="6" rx="1" fill="#2d3340" />
    {[36, 50, 64].map((y) => <g key={y}><rect x="62" y={y} width="26" height="5" rx="1" fill="#9aa3b2" /><rect x="94" y={y - 1} width="54" height="8" rx="2" fill="#eef1f5" stroke="#cfd5de" /></g>)}
    {highlight && <rect x="91" y="46" width="60" height="28" rx="3" fill="none" stroke="#ff6b22" strokeWidth="3" />}
  </svg>;
}

export function VmExample({ t }: { t: number }) {
  const state = vm.vmAt(t);
  const pip = vm.pipAt(t);
  const cursor = vm.cursorAt(t);
  const input = vm.chatInputAt(t);
  const card = vm.cardAt(t);
  const messages: ChatItem[] = vm.chatAt(t).map((message) => message.role === "user"
    ? { id: message.id, role: "user", text: message.text, images: Array.from({ length: message.images }, (_, index) => <SettingsThumb key={index} tab={index} />) }
    : { ...message, evidence: message.evidence ? <><SettingsThumb tab={vm.NETWORK_TAB} highlight /><small>03:27:43 · 설정 › 네트워크</small></> : undefined });
  return <>
    <Manager state={state} />
    {state.screen === "settings" && <Settings state={state} />}
    {state.error && <ErrorDialog />}

    <ClaudyChat project="homelab" messages={messages}
      input={{ text: input.text, typing: input.typing, attachments: Array.from({ length: input.attachments }, (_, index) => <SettingsThumb key={index} tab={index} />) }} />

    {card && <StickCard kind={card} x={600} y={card === "smart" ? 372 : 330}>
      {card === "dumb" && <span className={styles.cardNote}>BIOS…? 재설치…?</span>}
    </StickCard>}
    {pip.visible && <FolderPip pip={pip} />}

    <ShutterFlash opacity={state.capture.flash} />
    {state.capture.keys && <Keycaps><kbd>⊞ Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></Keycaps>}
    {vm.pasteKeysAt(t) && <Keycaps><kbd>Ctrl</kbd>+<kbd>V</kbd><span>{t < vm.BEATS.send1 ? `붙여넣기 ${Math.max(1, state.capture.count)}장째…` : "프롬프트 붙여넣기"}</span></Keycaps>}
    <Pointer {...cursor} />
    <Caption caption={vm.captionAt(t)} />
  </>;
}

function Manager({ state }: { state: vm.VmState }) {
  const running = state.status !== "off";
  const bootLines = state.status === "running" ? BOOT_LINES.length : state.status === "booting" ? 3 : 0;
  return <section className={styles.window} style={box(vm.VM)} aria-label="Box VM 관리자">
    <header className={styles.titleBar}><BoxVmLogo /><span>Box VM 관리자</span><em><Minus size={14} /><Square size={12} /><X size={14} /></em></header>
    <nav className={styles.menuBar}><span>파일(F)</span><span>머신(M)</span><span>도움말(H)</span></nav>
    <aside className={styles.rail}>{[0, 1, 2, 3, 4].map((index) => <i key={index} data-active={index === 0} />)}</aside>
    <div className={styles.toolbar}>
      <ToolButton x={90} label="새로 만들기(N)"><circle cx="16" cy="16" r="9" fill="#4aa8f0" /><path d="M16 2v6M16 24v6M2 16h6M24 16h6M6 6l4 4M22 22l4 4M26 6l-4 4M10 22l-4 4" stroke="#4aa8f0" strokeWidth="3" /></ToolButton>
      <ToolButton x={170} label="Open"><path d="M13 3h6v10h10v6H19v10h-6V19H3v-6h10z" fill="#36b24a" /></ToolButton>
      <ToolButton x={278} label="설정(S)"><circle cx="16" cy="16" r="10" fill="none" stroke="#f0a020" strokeWidth="6" strokeDasharray="4 3" /><circle cx="16" cy="16" r="7" fill="#f5b83d" /><circle cx="16" cy="16" r="3" fill="#fff" /></ToolButton>
      <ToolButton x={343} label="삭제" disabled><path d="M11 3h10v13h6L16 29 5 16h6z" fill="#c9ccd2" /></ToolButton>
      <ToolButton x={408} label="시작(T)"><path d="M3 11h14V4l13 12-13 12v-7H3z" fill="#43b83c" /></ToolButton>
    </div>
    <div className={styles.vmList}>
      <div className={styles.vmItem} data-selected="true"><VmBadge /><div><b>{vm.VM_NAME}</b><small><span className={styles.power} data-on={running} />{state.status === "running" ? "실행 중" : state.status === "booting" ? "시작하는 중" : "전원 꺼짐"}</small></div></div>
      <div className={styles.vmItem}><VmBadge tone="warm" /><div><b>cka-control</b><small><span className={styles.power} />전원 꺼짐</small></div></div>
    </div>
    <div className={styles.details}>
      <div className={styles.detailTabs}><b>정보</b><i /><i /><i /><i /></div>
      <div className={styles.detailTop}>
        <div>
          <DetailSection title="일반" rows={[["이름", vm.VM_NAME], ["운영 체제", "Ubuntu (64-bit)"]]} />
          <DetailSection title="시스템" rows={[["기본 메모리", "4096 MB"], ["프로세서", "2"], ["부팅 순서", "하드 디스크, 광 디스크"]]} />
        </div>
        <div className={styles.preview}>
          <b>미리 보기</b>
          <div className={styles.previewScreen} data-running={running}>
            {running ? BOOT_LINES.slice(0, bootLines).map((line) => <p key={line}>{line}</p>) : <strong>{vm.VM_NAME}</strong>}
          </div>
        </div>
      </div>
      <DetailSection title="디스플레이" rows={[["비디오 메모리", "128 MB"], ["그래픽 컨트롤러", "VMSVGA"]]} />
      <DetailSection title="저장소" rows={[["컨트롤러", "SATA"], ["SATA 포트 0", `${vm.VM_NAME}.vdi (일반, 25 GB)`]]} />
      <DetailSection title="오디오" rows={[["호스트 드라이버", "Default"], ["컨트롤러", "ICH AC97"]]} />
      <DetailSection title="네트워크" rows={[["어댑터 1", `Intel PRO/1000 MT Desktop (${state.adapter === "nat" ? "NAT" : "브리지 어댑터"})`]]} />
    </div>
  </section>;
}

function ToolButton({ x, label, disabled = false, children }: { x: number; label: string; disabled?: boolean; children: ReactNode }) {
  return <span className={styles.toolButton} data-disabled={disabled} style={{ left: x - 40 }}>
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">{children}</svg>{label}
  </span>;
}

function BoxVmLogo() {
  return <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 5l7-3 7 3v10l-7 3-7-3z" fill="#2f7fd8" /><path d="M3 5l7 3 7-3M10 8v10" stroke="#fff" strokeWidth="1.4" fill="none" /></svg>;
}

function VmBadge({ tone = "cool" }: { tone?: "cool" | "warm" }) {
  return <span className={styles.vmBadge} data-tone={tone}><em>x64</em></span>;
}

function DetailSection({ title, rows }: { title: string; rows: [string, string][] }) {
  return <div className={styles.detailSection}>
    <b><i />{title}</b>
    {rows.map(([label, value]) => <p key={label}><span>{label}:</span>{value}</p>)}
  </div>;
}

function ErrorDialog() {
  return <div className={styles.errorDialog} role="alertdialog" aria-label="Box VM 오류" style={box(vm.ERROR_DIALOG)}>
    <header>Box VM - 오류</header>
    <div><Warning size={34} weight="fill" /><p><b>가상 머신 &apos;{vm.VM_NAME}&apos;을(를) 시작하지 못했습니다.</b>알 수 없는 오류가 발생했습니다.<code>결과 코드: E_FAIL (0x80004005)</code></p></div>
    <span className={styles.dialogButton} style={{ left: vm.ERROR_OK.x - vm.ERROR_DIALOG.x - 40, top: vm.ERROR_OK.y - vm.ERROR_DIALOG.y - 14 }}>확인</span>
  </div>;
}

function Settings({ state }: { state: vm.VmState }) {
  const origin = { x: vm.SETTINGS.x, y: vm.SETTINGS.y };
  const tab = state.tab;
  const Icon = TAB_ICONS[tab];
  return <section className={styles.settings} style={box(vm.SETTINGS)} aria-label={`${vm.VM_NAME} 설정`}>
    <header className={styles.titleBar}><BoxVmLogo /><span>{vm.VM_NAME} - Settings</span><em><X size={14} /></em></header>
    <div className={styles.modeToggle}><span>Basic</span><b>Expert</b></div>
    <span className={styles.search}>Search settings</span>
    {vm.SETTINGS_TABS.map((label, index) => {
      const TabIcon = TAB_ICONS[index];
      return <span key={label} className={styles.settingsTab} data-selected={index === tab}
        style={{ left: vm.TAB_ROW.x - origin.x, top: vm.TAB_ROW.top - origin.y + index * vm.TAB_ROW.height, width: vm.TAB_ROW.width, height: vm.TAB_ROW.height - 4 }}>
        <TabIcon size={20} />{label}
      </span>;
    })}
    <div className={styles.settingsBody} key={tab}>
      <b className={styles.settingsHeading}><Icon size={18} />{vm.SETTINGS_TABS[tab]}</b>
      <div className={styles.fieldCard}>
        {tab !== vm.NETWORK_TAB && <>
          <div className={styles.subTabs}><b>기본</b><span>고급</span></div>
          {TAB_FIELDS[tab].filter(([label]) => label).map(([label, value]) => <p key={label} className={styles.field}><span>{label}</span><em>{value}<CaretDown size={12} /></em></p>)}
        </>}
      </div>
    </div>
    {/* The network pane is laid out against the settings window so the
        pointer can target its dropdown. */}
    {tab === vm.NETWORK_TAB && <NetworkPane state={state} origin={origin} />}
    <span className={styles.dialogButton} data-primary="true" style={{ left: vm.SETTINGS_OK.x - origin.x - 40, top: vm.SETTINGS_OK.y - origin.y - 14 }}>확인</span>
    <span className={styles.dialogButton} style={{ left: vm.SETTINGS_OK.x - origin.x + 50, top: vm.SETTINGS_OK.y - origin.y - 14 }}>취소</span>
    <span className={styles.dialogButton} style={{ left: vm.SETTINGS_OK.x - origin.x + 140, top: vm.SETTINGS_OK.y - origin.y - 14 }}>도움말(H)</span>
  </section>;
}

function NetworkPane({ state, origin }: { state: vm.VmState; origin: { x: number; y: number } }) {
  const nat = state.adapter === "nat";
  const dropdown = { left: vm.ATTACHED_DROPDOWN.x - origin.x - 80, top: vm.ATTACHED_DROPDOWN.y - origin.y - 16 };
  return <>
    <div className={`${styles.subTabs} ${styles.networkTabs}`}><b>어댑터 1</b><span>어댑터 2</span><span>어댑터 3</span><span>어댑터 4</span></div>
    <p className={styles.checkRow} style={{ top: 178 }}><i><Check size={11} weight="bold" /></i>네트워크 어댑터 사용(E)</p>
    <span className={styles.fieldLabel} style={{ top: dropdown.top + 6 }}>다음에 연결됨(A):</span>
    <span className={styles.dropdown} data-open={state.dropdownOpen} style={dropdown}>{nat ? "NAT" : "브리지 어댑터"}<CaretDown size={12} /></span>
    <span className={styles.fieldLabel} style={{ top: dropdown.top + 54 }}>이름(N):</span>
    <span className={styles.dropdown} data-disabled={nat} data-empty={!nat} style={{ ...dropdown, top: dropdown.top + 48 }}>{nat ? "" : "선택 안 됨"}<CaretDown size={12} /></span>
    <span className={styles.fieldLabel} style={{ top: dropdown.top + 102 }}>고급(D)</span>
    {state.dropdownOpen && <span className={styles.options} style={{ left: dropdown.left, top: dropdown.top + 32 }}>
      {["NAT", "브리지 어댑터", "내부 네트워크", "호스트 전용 어댑터", "일반 드라이버"].map((option, index) => <i key={option} data-active={index === 0}>{option}</i>)}
    </span>}
  </>;
}

function FolderPip({ pip }: { pip: vm.PipState }) {
  const origin = { x: vm.PIP.x, y: vm.PIP.y };
  return <PipFrame rect={vm.PIP} mode={pip.folder ? "Local Folder" : null} minimized={pip.minimized}>
    {pip.folder && <>
      <p className={styles.pipRow} style={{ top: 104 }}><span>전송 구간 <b>최근 60초</b></span><span><FolderOpen size={12} /> 저장 위치: …/Documents</span></p>
      <span className={styles.exportButton} data-busy={pip.exporting} style={{ left: 16, right: 16, top: vm.EXPORT_BUTTON.y - origin.y - 18 }}>
        {pip.exporting ? <CircleNotch className={styles.spin} size={15} /> : <FolderOpen size={15} />}AI Context 생성
      </span>
    </>}
    {pip.exported && <>
      <p className={styles.pipSuccess} style={{ top: 184 }}><Check size={13} weight="bold" />{vm.EXPORT_FOLDER}</p>
      <p className={styles.pipSteps} style={{ top: 206 }}>로컬 파일 접근이 가능한 Agent에 프롬프트를 붙여넣으세요.</p>
      <p className={styles.pipPrompt} style={{ top: 228 }}>{vm.EXPORT_PROMPT}</p>
      <span className={styles.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: vm.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "프롬프트 복사"}
      </span>
    </>}
  </PipFrame>;
}
