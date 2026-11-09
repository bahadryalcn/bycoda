/** Host-issued in-process capabilities. Only the actual Host authority mints
 * and recognizes these objects; they have no serialized/renderer constructor. */
declare const hostRunHandleBrand: unique symbol;
export type HostRunHandle = Readonly<{ [hostRunHandleBrand]: true }>;

declare const hostRunBindingBrand: unique symbol;
export type HostRunBinding = Readonly<{ [hostRunBindingBrand]: true }>;
