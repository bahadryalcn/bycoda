// mammoth ships types only for its Node entry; the browser bundle has the same API.
declare module "mammoth/mammoth.browser" {
  import mammoth = require("mammoth");
  export = mammoth;
}
