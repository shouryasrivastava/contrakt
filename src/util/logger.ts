import pc from "picocolors";

let verbose = false;

export function setVerbose(v: boolean) {
  verbose = v;
}

export const log = {
  info(msg: string) {
    console.log(pc.cyan("ℹ") + "  " + msg);
  },
  success(msg: string) {
    console.log(pc.green("✓") + "  " + msg);
  },
  warn(msg: string) {
    console.log(pc.yellow("⚠") + "  " + msg);
  },
  error(msg: string) {
    console.error(pc.red("✗") + "  " + msg);
  },
  dim(msg: string) {
    console.log(pc.dim(msg));
  },
  debug(msg: string) {
    if (verbose) console.log(pc.dim("[debug] " + msg));
  },
  breaking(msg: string) {
    console.log(pc.red("  ✗ [BREAKING]") + " " + msg);
  },
  nonBreaking(msg: string) {
    console.log(pc.yellow("  ~ [non-breaking]") + " " + msg);
  },
  additive(msg: string) {
    console.log(pc.green("  + [additive]") + " " + msg);
  },
  blank() {
    console.log();
  },
  header(msg: string) {
    console.log(pc.bold(pc.white(msg)));
  },
};
