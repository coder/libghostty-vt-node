#include "libghostty_vt_shim.hh"

#include <cassert>
#include <cstdio>

namespace libghostty_vt_node {

const char* ResultName(GhosttyResult result) {
  switch (result) {
    case GHOSTTY_SUCCESS:
      return "GHOSTTY_SUCCESS";
    case GHOSTTY_OUT_OF_MEMORY:
      return "GHOSTTY_OUT_OF_MEMORY";
    case GHOSTTY_INVALID_VALUE:
      return "GHOSTTY_INVALID_VALUE";
    case GHOSTTY_OUT_OF_SPACE:
      return "GHOSTTY_OUT_OF_SPACE";
    case GHOSTTY_NO_VALUE:
      return "GHOSTTY_NO_VALUE";
    default:
      return "GHOSTTY_UNKNOWN_RESULT";
  }
}

std::string ResultMessage(const char* operation, GhosttyResult result) {
  assert(operation != nullptr);
  return std::string(operation) + " failed: " + ResultName(result);
}

std::string GhosttyStringToString(GhosttyString value) {
  if (value.ptr == nullptr || value.len == 0) return {};
  return std::string(reinterpret_cast<const char*>(value.ptr), value.len);
}

std::string BuildInfoString(GhosttyBuildInfo info) {
  GhosttyString value = {};
  const GhosttyResult result = ghostty_build_info(info, &value);
  if (result != GHOSTTY_SUCCESS) return {};
  return GhosttyStringToString(value);
}

std::string Utf8FromCodepoint(uint32_t codepoint) {
  assert(codepoint <= 0x10FFFF);
  std::string out;
  if (codepoint <= 0x7F) {
    out.push_back(static_cast<char>(codepoint));
  } else if (codepoint <= 0x7FF) {
    out.push_back(static_cast<char>(0xC0 | (codepoint >> 6)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
  } else if (codepoint <= 0xFFFF) {
    out.push_back(static_cast<char>(0xE0 | (codepoint >> 12)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (codepoint >> 18)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
  }
  return out;
}

std::string HexColor(uint8_t r, uint8_t g, uint8_t b) {
  char buf[8] = {};
  const int written = std::snprintf(buf, sizeof(buf), "#%02x%02x%02x", r, g, b);
  assert(written == 7);
  return std::string(buf, 7);
}

}  // namespace libghostty_vt_node
