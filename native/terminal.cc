#include "terminal.hh"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace libghostty_vt_node {
namespace {

uint16_t PositiveUint16(Napi::Env env, const Napi::Value& value, const char* name) {
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string(name) + " must be a positive integer");
  }
  const double number = value.As<Napi::Number>().DoubleValue();
  if (number <= 0 || number != static_cast<uint32_t>(number) ||
      number > std::numeric_limits<uint16_t>::max()) {
    throw Napi::RangeError::New(env, std::string(name) + " must be a positive 16-bit integer");
  }
  return static_cast<uint16_t>(number);
}

size_t NonNegativeSize(Napi::Env env, const Napi::Value& value, const char* name) {
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string(name) + " must be a non-negative integer");
  }
  const double number = value.As<Napi::Number>().DoubleValue();
  if (number < 0 || number != static_cast<uint64_t>(number)) {
    throw Napi::RangeError::New(env, std::string(name) + " must be a non-negative integer");
  }
  return static_cast<size_t>(number);
}

uint32_t PositiveUint32(Napi::Env env, const Napi::Value& value, const char* name) {
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string(name) + " must be a positive integer");
  }
  const double number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number <= 0 || number != std::floor(number) ||
      number > std::numeric_limits<uint32_t>::max()) {
    throw Napi::RangeError::New(env, std::string(name) + " must be a positive 32-bit integer");
  }
  return static_cast<uint32_t>(number);
}

uint32_t NonNegativeUint32(Napi::Env env, const Napi::Value& value, const char* name) {
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string(name) + " must be a non-negative integer");
  }
  const double number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number < 0 || number != std::floor(number) ||
      number > std::numeric_limits<uint32_t>::max()) {
    throw Napi::RangeError::New(env, std::string(name) + " must be a non-negative 32-bit integer");
  }
  return static_cast<uint32_t>(number);
}

float FiniteFloat(Napi::Env env, const Napi::Value& value, const char* name) {
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string(name) + " must be a finite number");
  }
  const double number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number < -std::numeric_limits<float>::max() ||
      number > std::numeric_limits<float>::max()) {
    throw Napi::RangeError::New(env, std::string(name) + " must be a finite 32-bit float");
  }
  return static_cast<float>(number);
}

GhosttyMouseAction ParseMouseAction(Napi::Env env, const Napi::Value& value) {
  if (!value.IsString()) throw Napi::TypeError::New(env, "mouse action must be a string");
  const std::string action = value.As<Napi::String>().Utf8Value();
  if (action == "press") return GHOSTTY_MOUSE_ACTION_PRESS;
  if (action == "release") return GHOSTTY_MOUSE_ACTION_RELEASE;
  if (action == "motion") return GHOSTTY_MOUSE_ACTION_MOTION;
  throw Napi::RangeError::New(env, "mouse action is invalid");
}

GhosttyMouseButton ParseMouseButton(Napi::Env env, const Napi::Value& value) {
  if (!value.IsString()) throw Napi::TypeError::New(env, "mouse button must be a string");
  const std::string button = value.As<Napi::String>().Utf8Value();
  if (button == "left") return GHOSTTY_MOUSE_BUTTON_LEFT;
  if (button == "right") return GHOSTTY_MOUSE_BUTTON_RIGHT;
  if (button == "middle") return GHOSTTY_MOUSE_BUTTON_MIDDLE;
  if (button == "four") return GHOSTTY_MOUSE_BUTTON_FOUR;
  if (button == "five") return GHOSTTY_MOUSE_BUTTON_FIVE;
  if (button == "six") return GHOSTTY_MOUSE_BUTTON_SIX;
  if (button == "seven") return GHOSTTY_MOUSE_BUTTON_SEVEN;
  if (button == "eight") return GHOSTTY_MOUSE_BUTTON_EIGHT;
  if (button == "nine") return GHOSTTY_MOUSE_BUTTON_NINE;
  if (button == "ten") return GHOSTTY_MOUSE_BUTTON_TEN;
  if (button == "eleven") return GHOSTTY_MOUSE_BUTTON_ELEVEN;
  throw Napi::RangeError::New(env, "mouse button is invalid");
}

bool OptionBool(const Napi::Object& options, const char* name) {
  const Napi::Value value = options.Get(name);
  return value.IsBoolean() && value.As<Napi::Boolean>().Value();
}

GhosttyMods ParseMouseModifiers(Napi::Env env, const Napi::Value& value) {
  if (value.IsUndefined()) return 0;
  if (!value.IsObject()) throw Napi::TypeError::New(env, "mouse modifiers must be an object");
  const Napi::Object modifiers = value.As<Napi::Object>();
  GhosttyMods result = 0;
  if (OptionBool(modifiers, "shift")) result |= GHOSTTY_MODS_SHIFT;
  if (OptionBool(modifiers, "ctrl")) result |= GHOSTTY_MODS_CTRL;
  if (OptionBool(modifiers, "alt")) result |= GHOSTTY_MODS_ALT;
  return result;
}

bool MouseSizeEqual(const GhosttyMouseEncoderSize& left, const GhosttyMouseEncoderSize& right) {
  return left.screen_width == right.screen_width &&
         left.screen_height == right.screen_height &&
         left.cell_width == right.cell_width &&
         left.cell_height == right.cell_height &&
         left.padding_top == right.padding_top &&
         left.padding_bottom == right.padding_bottom &&
         left.padding_right == right.padding_right &&
         left.padding_left == right.padding_left;
}

void ThrowResult(Napi::Env env, const char* operation, GhosttyResult result) {
  throw Napi::Error::New(env, ResultMessage(operation, result));
}

}  // namespace

Napi::FunctionReference TerminalWrap::constructor;

void TerminalWrap::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(
      env,
      "GhosttyVtTerminal",
      {
          InstanceMethod("feed", &TerminalWrap::Feed),
          InstanceMethod("resize", &TerminalWrap::Resize),
          InstanceMethod("encodeMouse", &TerminalWrap::EncodeMouse),
          InstanceMethod("snapshot", &TerminalWrap::Snapshot),
          InstanceMethod("getVisibleText", &TerminalWrap::GetVisibleText),
          InstanceMethod("formatPlain", &TerminalWrap::FormatPlain),
          InstanceMethod("formatHtml", &TerminalWrap::FormatHtml),
          InstanceMethod("dispose", &TerminalWrap::Dispose),
      });

  constructor = Napi::Persistent(func);
  constructor.SuppressDestruct();
  exports.Set("createTerminal", Napi::Function::New(env, CreateTerminal));
}

Napi::Object TerminalWrap::Create(Napi::Env env, const Napi::Object& options) {
  return constructor.New({options});
}

TerminalWrap::TerminalWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<TerminalWrap>(info) {
  Napi::Env env = info.Env();
  if (info.Length() != 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "createTerminal options must be an object");
  }

  const Napi::Object options = info[0].As<Napi::Object>();
  const uint16_t cols = PositiveUint16(env, options.Get("cols"), "cols");
  const uint16_t rows = PositiveUint16(env, options.Get("rows"), "rows");
  size_t scrollback = 0;
  if (options.Has("scrollbackLimit") && !options.Get("scrollbackLimit").IsUndefined()) {
    scrollback = NonNegativeSize(env, options.Get("scrollbackLimit"), "scrollbackLimit");
  }

  GhosttyTerminalOptions native_options = {};
  native_options.cols = cols;
  native_options.rows = rows;
  native_options.max_scrollback = scrollback;

  GhosttyTerminal created = nullptr;
  const GhosttyResult result = ghostty_terminal_new(nullptr, &created, native_options);
  if (result != GHOSTTY_SUCCESS) {
    ThrowResult(env, "ghostty_terminal_new", result);
  }
  assert(created != nullptr);
  terminal_ = created;

  GhosttyMouseEncoder mouse_encoder = nullptr;
  const GhosttyResult mouse_result = ghostty_mouse_encoder_new(nullptr, &mouse_encoder);
  if (mouse_result != GHOSTTY_SUCCESS) {
    ghostty_terminal_free(terminal_);
    terminal_ = nullptr;
    ThrowResult(env, "ghostty_mouse_encoder_new", mouse_result);
  }
  assert(mouse_encoder != nullptr);
  mouse_encoder_ = mouse_encoder;
}

TerminalWrap::~TerminalWrap() { DisposeNative(); }

void TerminalWrap::DisposeNative() {
  if (mouse_encoder_ != nullptr) {
    ghostty_mouse_encoder_free(mouse_encoder_);
    mouse_encoder_ = nullptr;
  }
  if (terminal_ != nullptr) {
    ghostty_terminal_free(terminal_);
    terminal_ = nullptr;
  }
}

GhosttyTerminal TerminalWrap::RequireTerminal(Napi::Env env) {
  if (terminal_ == nullptr) {
    throw Napi::Error::New(env, "GhosttyVtTerminal has been disposed");
  }
  return terminal_;
}

GhosttyMouseEncoder TerminalWrap::RequireMouseEncoder(Napi::Env env) {
  if (mouse_encoder_ == nullptr) {
    throw Napi::Error::New(env, "GhosttyVtTerminal has been disposed");
  }
  return mouse_encoder_;
}

Napi::Value TerminalWrap::Feed(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GhosttyTerminal terminal = RequireTerminal(env);
  if (env.IsExceptionPending()) return env.Undefined();

  const uint8_t* data = nullptr;
  size_t len = 0;
  std::string string_data;

  if (info.Length() != 1) {
    throw Napi::TypeError::New(env, "feed expects exactly one argument");
  }

  if (info[0].IsString()) {
    string_data = info[0].As<Napi::String>().Utf8Value();
    data = reinterpret_cast<const uint8_t*>(string_data.data());
    len = string_data.size();
  } else if (info[0].IsBuffer()) {
    const auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    data = buffer.Data();
    len = buffer.Length();
  } else if (info[0].IsTypedArray()) {
    const auto typed_array = info[0].As<Napi::TypedArray>();
    if (typed_array.TypedArrayType() != napi_uint8_array) {
      throw Napi::TypeError::New(env, "feed typed array must be Uint8Array");
    }
    const auto array = info[0].As<Napi::Uint8Array>();
    data = array.Data();
    len = array.ByteLength();
  } else {
    throw Napi::TypeError::New(env, "feed data must be a string, Buffer, or Uint8Array");
  }

  if (len == 0) return env.Undefined();
  assert(data != nullptr);
  ghostty_terminal_vt_write(terminal, data, len);
  mouse_modes_dirty_ = true;
  return env.Undefined();
}

Napi::Value TerminalWrap::Resize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GhosttyTerminal terminal = RequireTerminal(env);
  if (env.IsExceptionPending()) return env.Undefined();
  if (info.Length() != 2) {
    throw Napi::TypeError::New(env, "resize expects cols and rows");
  }

  const uint16_t cols = PositiveUint16(env, info[0], "cols");
  const uint16_t rows = PositiveUint16(env, info[1], "rows");
  const GhosttyResult result = ghostty_terminal_resize(terminal, cols, rows, 0, 0);
  if (result != GHOSTTY_SUCCESS) {
    ThrowResult(env, "ghostty_terminal_resize", result);
  }
  return env.Undefined();
}

// Encode against the child-negotiated terminal state while caching geometry so
// Ghostty's same-cell motion deduplication survives unchanged input dimensions.
Napi::Value TerminalWrap::EncodeMouse(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GhosttyTerminal terminal = RequireTerminal(env);
  GhosttyMouseEncoder encoder = RequireMouseEncoder(env);
  if (env.IsExceptionPending()) return env.Undefined();
  if (info.Length() != 2 || !info[0].IsObject() || !info[1].IsObject()) {
    throw Napi::TypeError::New(env, "encodeMouse expects event and options objects");
  }

  const Napi::Object input = info[0].As<Napi::Object>();
  const Napi::Object options = info[1].As<Napi::Object>();
  const Napi::Value geometry_value = options.Get("geometry");
  if (!geometry_value.IsObject()) {
    throw Napi::TypeError::New(env, "mouse geometry must be an object");
  }
  const Napi::Object geometry = geometry_value.As<Napi::Object>();

  GhosttyMouseEncoderSize size = {};
  size.size = sizeof(GhosttyMouseEncoderSize);
  size.screen_width = PositiveUint32(env, geometry.Get("screenWidth"), "screenWidth");
  size.screen_height = PositiveUint32(env, geometry.Get("screenHeight"), "screenHeight");
  size.cell_width = PositiveUint32(env, geometry.Get("cellWidth"), "cellWidth");
  size.cell_height = PositiveUint32(env, geometry.Get("cellHeight"), "cellHeight");
  size.padding_top = NonNegativeUint32(env, geometry.Get("paddingTop"), "paddingTop");
  size.padding_bottom = NonNegativeUint32(env, geometry.Get("paddingBottom"), "paddingBottom");
  size.padding_right = NonNegativeUint32(env, geometry.Get("paddingRight"), "paddingRight");
  size.padding_left = NonNegativeUint32(env, geometry.Get("paddingLeft"), "paddingLeft");

  if (mouse_modes_dirty_) {
    ghostty_mouse_encoder_setopt_from_terminal(encoder, terminal);
    mouse_modes_dirty_ = false;
  }
  if (!mouse_size_configured_ || !MouseSizeEqual(size, mouse_size_)) {
    ghostty_mouse_encoder_setopt(encoder, GHOSTTY_MOUSE_ENCODER_OPT_SIZE, &size);
    mouse_size_ = size;
    mouse_size_configured_ = true;
  }
  const bool any_button_pressed = OptionBool(options, "anyButtonPressed");
  ghostty_mouse_encoder_setopt(
      encoder, GHOSTTY_MOUSE_ENCODER_OPT_ANY_BUTTON_PRESSED, &any_button_pressed);
  const bool track_last_cell = OptionBool(options, "trackLastCell");
  ghostty_mouse_encoder_setopt(
      encoder, GHOSTTY_MOUSE_ENCODER_OPT_TRACK_LAST_CELL, &track_last_cell);

  GhosttyMouseEvent event = nullptr;
  GhosttyResult result = ghostty_mouse_event_new(nullptr, &event);
  if (result != GHOSTTY_SUCCESS) ThrowResult(env, "ghostty_mouse_event_new", result);
  assert(event != nullptr);

  try {
    ghostty_mouse_event_set_action(event, ParseMouseAction(env, input.Get("action")));
    const Napi::Value button = input.Get("button");
    if (button.IsUndefined()) {
      ghostty_mouse_event_clear_button(event);
    } else {
      ghostty_mouse_event_set_button(event, ParseMouseButton(env, button));
    }
    ghostty_mouse_event_set_mods(event, ParseMouseModifiers(env, input.Get("modifiers")));
    ghostty_mouse_event_set_position(
        event,
        GhosttyMousePosition{
            FiniteFloat(env, input.Get("x"), "mouse x"),
            FiniteFloat(env, input.Get("y"), "mouse y"),
        });

    size_t required = 0;
    result = ghostty_mouse_encoder_encode(encoder, event, nullptr, 0, &required);
    if (result == GHOSTTY_SUCCESS) {
      assert(required == 0);
      ghostty_mouse_event_free(event);
      return Napi::Buffer<uint8_t>::New(env, 0);
    }
    if (result != GHOSTTY_OUT_OF_SPACE) {
      ThrowResult(env, "ghostty_mouse_encoder_encode(size)", result);
    }
    if (required == 0) {
      throw Napi::Error::New(env, "ghostty_mouse_encoder_encode returned an empty size");
    }

    std::vector<uint8_t> output(required);
    size_t written = 0;
    result = ghostty_mouse_encoder_encode(
        encoder, event, reinterpret_cast<char*>(output.data()), output.size(), &written);
    if (result != GHOSTTY_SUCCESS) {
      ThrowResult(env, "ghostty_mouse_encoder_encode", result);
    }
    assert(written <= output.size());
    ghostty_mouse_event_free(event);
    return Napi::Buffer<uint8_t>::Copy(env, output.data(), written);
  } catch (...) {
    ghostty_mouse_event_free(event);
    throw;
  }
}

Napi::Value TerminalWrap::Snapshot(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  RequireTerminal(env);
  if (env.IsExceptionPending()) return env.Undefined();

  bool include_scrollback = false;
  bool include_cells = false;
  if (info.Length() > 0 && !info[0].IsUndefined()) {
    if (!info[0].IsObject()) {
      throw Napi::TypeError::New(env, "snapshot options must be an object");
    }
    const Napi::Object options = info[0].As<Napi::Object>();
    include_scrollback = OptionBool(options, "includeScrollback");
    include_cells = OptionBool(options, "includeCells");
  }

  try {
    return BuildSnapshot(env, include_scrollback, include_cells);
  } catch (const std::exception& err) {
    throw Napi::Error::New(env, err.what());
  }
}

Napi::Value TerminalWrap::GetVisibleText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  RequireTerminal(env);
  if (env.IsExceptionPending()) return env.Undefined();

  try {
    uint16_t rows = 0;
    const GhosttyResult result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_ROWS, &rows);
    if (result != GHOSTTY_SUCCESS) {
      ThrowResult(env, "ghostty_terminal_get(rows)", result);
    }

    std::string text;
    for (uint32_t row = 0; row < rows; row++) {
      if (row > 0) text.push_back('\n');
      text += ReadLine(GHOSTTY_POINT_TAG_ACTIVE, row, nullptr, env);
    }
    return Napi::String::New(env, text);
  } catch (const std::exception& err) {
    throw Napi::Error::New(env, err.what());
  }
}

Napi::Value TerminalWrap::FormatPlain(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  RequireTerminal(env);
  if (env.IsExceptionPending()) return env.Undefined();
  try {
    return Napi::String::New(env, Format(GHOSTTY_FORMATTER_FORMAT_PLAIN, true));
  } catch (const std::exception& err) {
    throw Napi::Error::New(env, err.what());
  }
}

Napi::Value TerminalWrap::FormatHtml(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  RequireTerminal(env);
  if (env.IsExceptionPending()) return env.Undefined();
  try {
    return Napi::String::New(env, Format(GHOSTTY_FORMATTER_FORMAT_HTML, true));
  } catch (const std::exception& err) {
    throw Napi::Error::New(env, err.what());
  }
}

Napi::Value TerminalWrap::Dispose(const Napi::CallbackInfo& info) {
  DisposeNative();
  return info.Env().Undefined();
}

std::string TerminalWrap::Format(GhosttyFormatterFormat format, bool trim) {
  assert(terminal_ != nullptr);
  GhosttyFormatterTerminalOptions options = {};
  options.size = sizeof(GhosttyFormatterTerminalOptions);
  options.emit = format;
  options.trim = trim;
  options.unwrap = false;
  options.extra.size = sizeof(GhosttyFormatterTerminalExtra);
  options.extra.screen.size = sizeof(GhosttyFormatterScreenExtra);

  GhosttyFormatter formatter = nullptr;
  GhosttyResult result = ghostty_formatter_terminal_new(nullptr, &formatter, terminal_, options);
  if (result != GHOSTTY_SUCCESS) {
    throw std::runtime_error(ResultMessage("ghostty_formatter_terminal_new", result));
  }
  assert(formatter != nullptr);

  uint8_t* ptr = nullptr;
  size_t len = 0;
  result = ghostty_formatter_format_alloc(formatter, nullptr, &ptr, &len);
  ghostty_formatter_free(formatter);
  if (result != GHOSTTY_SUCCESS) {
    throw std::runtime_error(ResultMessage("ghostty_formatter_format_alloc", result));
  }
  assert(ptr != nullptr || len == 0);

  std::string output;
  if (ptr != nullptr && len > 0) {
    output.assign(reinterpret_cast<const char*>(ptr), len);
  }
  ghostty_free(nullptr, ptr, len);
  return output;
}

Napi::Object TerminalWrap::BuildSnapshot(Napi::Env env, bool include_scrollback, bool include_cells) {
  assert(terminal_ != nullptr);
  uint16_t cols = 0;
  uint16_t rows = 0;
  uint16_t cursor_col = 0;
  uint16_t cursor_row = 0;
  GhosttyTerminalScreen active_screen = GHOSTTY_TERMINAL_SCREEN_PRIMARY;

  GhosttyResult result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_COLS, &cols);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_terminal_get(cols)", result));
  result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_ROWS, &rows);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_terminal_get(rows)", result));
  result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_CURSOR_X, &cursor_col);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_terminal_get(cursor x)", result));
  result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_CURSOR_Y, &cursor_row);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_terminal_get(cursor y)", result));
  result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN, &active_screen);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_terminal_get(active screen)", result));

  std::vector<Napi::Object> cells;
  Napi::Array visible_lines = Napi::Array::New(env, rows);
  for (uint32_t row = 0; row < rows; row++) {
    const std::string text = ReadLine(GHOSTTY_POINT_TAG_ACTIVE, row, include_cells ? &cells : nullptr, env);
    Napi::Object line = Napi::Object::New(env);
    line.Set("row", Napi::Number::New(env, row));
    line.Set("text", Napi::String::New(env, text));
    visible_lines.Set(row, line);
  }

  Napi::Object snapshot = Napi::Object::New(env);
  snapshot.Set("cols", Napi::Number::New(env, cols));
  snapshot.Set("rows", Napi::Number::New(env, rows));
  snapshot.Set("cursorRow", Napi::Number::New(env, cursor_row));
  snapshot.Set("cursorCol", Napi::Number::New(env, cursor_col));
  snapshot.Set("isAltScreen", Napi::Boolean::New(env, active_screen == GHOSTTY_TERMINAL_SCREEN_ALTERNATE));
  snapshot.Set("visibleLines", visible_lines);

  if (include_scrollback) {
    size_t scrollback_rows = 0;
    result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS, &scrollback_rows);
    if (result != GHOSTTY_SUCCESS) {
      throw std::runtime_error(ResultMessage("ghostty_terminal_get(scrollback rows)", result));
    }
    const uint32_t count = static_cast<uint32_t>(std::min<size_t>(scrollback_rows, std::numeric_limits<uint32_t>::max()));
    snapshot.Set("scrollbackLines", BuildLines(env, GHOSTTY_POINT_TAG_HISTORY, count, 0));
  }

  if (include_cells) {
    Napi::Array cell_array = Napi::Array::New(env, cells.size());
    for (size_t i = 0; i < cells.size(); i++) {
      cell_array.Set(static_cast<uint32_t>(i), cells[i]);
    }
    snapshot.Set("cells", cell_array);
  }

  return snapshot;
}

Napi::Array TerminalWrap::BuildLines(Napi::Env env, GhosttyPointTag tag, uint32_t rows, int32_t row_offset) {
  Napi::Array lines = Napi::Array::New(env, rows);
  for (uint32_t row = 0; row < rows; row++) {
    Napi::Object line = Napi::Object::New(env);
    line.Set("row", Napi::Number::New(env, static_cast<int64_t>(row) + row_offset));
    line.Set("text", Napi::String::New(env, ReadLine(tag, row, nullptr, env)));
    lines.Set(row, line);
  }
  return lines;
}

std::string TerminalWrap::ReadLine(GhosttyPointTag tag, uint32_t row, std::vector<Napi::Object>* cells, Napi::Env env) {
  assert(terminal_ != nullptr);
  uint16_t cols = 0;
  GhosttyResult result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_COLS, &cols);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_terminal_get(cols)", result));

  std::string text;
  for (uint16_t col = 0; col < cols; col++) {
    GhosttyGridRef ref = {};
    ref.size = sizeof(GhosttyGridRef);

    GhosttyPoint point = {};
    point.tag = tag;
    point.value.coordinate.x = col;
    point.value.coordinate.y = row;

    result = ghostty_terminal_grid_ref(terminal_, point, &ref);
    if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_terminal_grid_ref", result));

    GhosttyCell cell = 0;
    result = ghostty_grid_ref_cell(&ref, &cell);
    if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_grid_ref_cell", result));

    bool has_text = false;
    result = ghostty_cell_get(cell, GHOSTTY_CELL_DATA_HAS_TEXT, &has_text);
    if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_cell_get(has text)", result));

    GhosttyCellWide wide = GHOSTTY_CELL_WIDE_NARROW;
    result = ghostty_cell_get(cell, GHOSTTY_CELL_DATA_WIDE, &wide);
    if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_cell_get(wide)", result));
    if (wide == GHOSTTY_CELL_WIDE_SPACER_TAIL || wide == GHOSTTY_CELL_WIDE_SPACER_HEAD) {
      continue;
    }

    if (!has_text) {
      text.push_back(' ');
      continue;
    }

    const std::string cell_text = ReadCellText(ref, cell);
    text += cell_text;
    if (cells != nullptr && !cell_text.empty()) {
      cells->push_back(BuildCellObject(env, row, col, cell_text, cell, ref));
    }
  }

  while (!text.empty() && text.back() == ' ') {
    text.pop_back();
  }
  return text;
}

std::string TerminalWrap::ReadCellText(const GhosttyGridRef& ref, GhosttyCell cell) {
  GhosttyCellContentTag tag = GHOSTTY_CELL_CONTENT_CODEPOINT;
  GhosttyResult result = ghostty_cell_get(cell, GHOSTTY_CELL_DATA_CONTENT_TAG, &tag);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_cell_get(content tag)", result));

  if (tag == GHOSTTY_CELL_CONTENT_CODEPOINT_GRAPHEME) {
    size_t required = 0;
    result = ghostty_grid_ref_graphemes(&ref, nullptr, 0, &required);
    if (result == GHOSTTY_OUT_OF_SPACE && required > 0) {
      std::vector<uint32_t> codepoints(required);
      size_t written = 0;
      result = ghostty_grid_ref_graphemes(&ref, codepoints.data(), codepoints.size(), &written);
      if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_grid_ref_graphemes", result));
      assert(written <= codepoints.size());
      std::string out;
      for (size_t i = 0; i < written; i++) {
        out += Utf8FromCodepoint(codepoints[i]);
      }
      return out;
    }
  }

  uint32_t codepoint = 0;
  result = ghostty_cell_get(cell, GHOSTTY_CELL_DATA_CODEPOINT, &codepoint);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_cell_get(codepoint)", result));
  if (codepoint == 0) return {};
  return Utf8FromCodepoint(codepoint);
}

Napi::Object TerminalWrap::BuildCellObject(
    Napi::Env env,
    uint32_t row,
    uint16_t col,
    const std::string& text,
    GhosttyCell cell,
    const GhosttyGridRef& ref) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("row", Napi::Number::New(env, row));
  obj.Set("col", Napi::Number::New(env, col));
  obj.Set("text", Napi::String::New(env, text));

  GhosttyCellWide wide = GHOSTTY_CELL_WIDE_NARROW;
  GhosttyResult result = ghostty_cell_get(cell, GHOSTTY_CELL_DATA_WIDE, &wide);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_cell_get(wide)", result));
  obj.Set("width", Napi::Number::New(env, wide == GHOSTTY_CELL_WIDE_WIDE ? 2 : 1));

  bool has_styling = false;
  result = ghostty_cell_get(cell, GHOSTTY_CELL_DATA_HAS_STYLING, &has_styling);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_cell_get(has styling)", result));
  if (!has_styling) return obj;

  GhosttyStyle style = {};
  style.size = sizeof(GhosttyStyle);
  result = ghostty_grid_ref_style(&ref, &style);
  if (result != GHOSTTY_SUCCESS) throw std::runtime_error(ResultMessage("ghostty_grid_ref_style", result));

  if (style.bold) obj.Set("bold", Napi::Boolean::New(env, true));
  if (style.italic) obj.Set("italic", Napi::Boolean::New(env, true));
  if (style.underline != 0) obj.Set("underline", Napi::Boolean::New(env, true));

  const std::string fg = ResolveStyleColor(style.fg_color);
  const std::string bg = ResolveStyleColor(style.bg_color);
  if (!fg.empty()) obj.Set("foreground", Napi::String::New(env, fg));
  if (!bg.empty()) obj.Set("background", Napi::String::New(env, bg));

  return obj;
}

std::string TerminalWrap::ResolveStyleColor(const GhosttyStyleColor& color) {
  if (color.tag == GHOSTTY_STYLE_COLOR_NONE) return {};
  if (color.tag == GHOSTTY_STYLE_COLOR_RGB) {
    return HexColor(color.value.rgb.r, color.value.rgb.g, color.value.rgb.b);
  }
  if (color.tag == GHOSTTY_STYLE_COLOR_PALETTE) {
    GhosttyColorRgb palette[256] = {};
    const GhosttyResult result = ghostty_terminal_get(terminal_, GHOSTTY_TERMINAL_DATA_COLOR_PALETTE, palette);
    if (result != GHOSTTY_SUCCESS) return {};
    const GhosttyColorRgb rgb = palette[color.value.palette];
    return HexColor(rgb.r, rgb.g, rgb.b);
  }
  assert(false && "unknown GhosttyStyleColorTag");
  return {};
}

Napi::Value CreateTerminal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "createTerminal options must be an object");
  }
  return TerminalWrap::Create(env, info[0].As<Napi::Object>());
}

Napi::Value GetNativeInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  uint32_t napi_version = 0;
  const napi_status status = napi_get_version(env, &napi_version);
  assert(status == napi_ok);

  Napi::Object result = Napi::Object::New(env);
  result.Set("napiVersion", Napi::Number::New(env, napi_version));

  const std::string ghostty_version = BuildInfoString(GHOSTTY_BUILD_INFO_VERSION_STRING);
  const std::string ghostty_commit = BuildInfoString(GHOSTTY_BUILD_INFO_VERSION_BUILD);
  if (!ghostty_version.empty()) {
    result.Set("ghosttyVersion", Napi::String::New(env, ghostty_version));
  }
  if (!ghostty_commit.empty()) {
    result.Set("ghosttyCommit", Napi::String::New(env, ghostty_commit));
  }

  return result;
}

}  // namespace libghostty_vt_node
