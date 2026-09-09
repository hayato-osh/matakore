// 検出成功は画面を見なくても分かるように返す（§4.1）。
// iOS は Vibration API を実装していないので、振動と短い効果音の両方を鳴らす。

let ctx: AudioContext | null = null

const beep = () => {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    // iOS では最初のユーザー操作以降でないと resume できない
    void ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 1180
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.13)
  } catch {
    // 音が鳴らないだけなのでスキャン自体は続行する
  }
}

export const scanFeedback = () => {
  navigator.vibrate?.(35)
  beep()
}

/** iOS 対策。ユーザー操作の中で一度だけ AudioContext を起こしておく。 */
export const primeAudio = () => {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    void ctx.resume()
  } catch {
    // 無視してよい
  }
}
