#pragma once

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "libghostty_vt_shim.hh"

namespace libghostty_vt_node {

class TerminalWrap final : public Napi::ObjectWrap<TerminalWrap> {
 public:
  static void Init(Napi::Env env, Napi::Object exports);
  static Napi::Object Create(Napi::Env env, const Napi::Object& options);

  explicit TerminalWrap(const Napi::CallbackInfo& info);
  ~TerminalWrap() override;

 private:
  static Napi::FunctionReference constructor;

  void DisposeNative();
  GhosttyTerminal RequireTerminal(Napi::Env env);
  GhosttyMouseEncoder RequireMouseEncoder(Napi::Env env);
  Napi::Value Feed(const Napi::CallbackInfo& info);
  Napi::Value Resize(const Napi::CallbackInfo& info);
  Napi::Value EncodeMouse(const Napi::CallbackInfo& info);
  Napi::Value Snapshot(const Napi::CallbackInfo& info);
  Napi::Value GetVisibleText(const Napi::CallbackInfo& info);
  Napi::Value FormatPlain(const Napi::CallbackInfo& info);
  Napi::Value FormatHtml(const Napi::CallbackInfo& info);
  Napi::Value Dispose(const Napi::CallbackInfo& info);

  std::string Format(GhosttyFormatterFormat format, bool trim);
  Napi::Object BuildSnapshot(Napi::Env env, bool include_scrollback, bool include_cells);
  Napi::Array BuildLines(Napi::Env env, GhosttyPointTag tag, uint32_t rows, int32_t row_offset);
  std::string ReadLine(GhosttyPointTag tag, uint32_t row, std::vector<Napi::Object>* cells, Napi::Env env);
  std::string ReadCellText(const GhosttyGridRef& ref, GhosttyCell cell);
  Napi::Object BuildCellObject(Napi::Env env, uint32_t row, uint16_t col, const std::string& text, GhosttyCell cell, const GhosttyGridRef& ref);
  std::string ResolveStyleColor(const GhosttyStyleColor& color);

  GhosttyTerminal terminal_ = nullptr;
  GhosttyMouseEncoder mouse_encoder_ = nullptr;
  bool mouse_modes_dirty_ = true;
  bool mouse_size_configured_ = false;
  GhosttyMouseEncoderSize mouse_size_ = {};
};

Napi::Value CreateTerminal(const Napi::CallbackInfo& info);
Napi::Value GetNativeInfo(const Napi::CallbackInfo& info);

}  // namespace libghostty_vt_node
