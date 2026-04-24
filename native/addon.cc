#include <napi.h>

#include "terminal.hh"

namespace libghostty_vt_node {

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  TerminalWrap::Init(env, exports);
  exports.Set("getNativeInfo", Napi::Function::New(env, GetNativeInfo));
  return exports;
}

NODE_API_MODULE(libghostty_vt_node, InitAll)

}  // namespace libghostty_vt_node
