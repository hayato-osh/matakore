/** CSS Modules のクラスを組み立てる。false / undefined は落とす。 */
export const cx = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(' ')
