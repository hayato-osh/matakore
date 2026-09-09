import styles from './TabIcon.module.css'

export type IconName = 'scan' | 'queue' | 'list' | 'settings'

/**
 * アイコンフォントは使わない（オフラインで落ちるうえ1文字のために重い）。
 * 線画で持ち、角は落とさない。丸めると親しみは出るが、帳票の硬さが消える。
 * 意味はこのアプリの語彙に合わせている（枠＝トンボ、丸＝印、罫＝帳簿）。
 */
export default function TabIcon({ name }: { name: IconName }) {
  return (
    <svg
      className={styles.glyph}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      aria-hidden
    >
      {name === 'scan' && (
        <>
          {/* トンボ（読み取り枠）とバーコード */}
          <path d="M3 8V3.5h4.5M16.5 3.5H21V8M21 16v4.5h-4.5M7.5 20.5H3V16" />
          <path d="M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7" />
        </>
      )}
      {name === 'queue' && (
        /* まだ押されていない印 */
        <circle cx="12" cy="12" r="7.5" strokeDasharray="2.6 3.2" />
      )}
      {name === 'list' && (
        <>
          {/* 綴じ代のある帳面 */}
          <path d="M6 3.5v17" />
          <path d="M9.5 7.5h11M9.5 12h11M9.5 16.5h7" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M3.5 8.5h9.5M17 8.5h3.5M3.5 16h4M11.5 16h9" />
          <circle cx="15" cy="8.5" r="2.1" />
          <circle cx="9.5" cy="16" r="2.1" />
        </>
      )}
    </svg>
  )
}
