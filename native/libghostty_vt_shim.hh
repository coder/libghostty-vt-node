#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#ifndef GHOSTTY_STATIC
#define GHOSTTY_STATIC
#endif
#include <ghostty/vt.h>

namespace libghostty_vt_node {

const char* ResultName(GhosttyResult result);
std::string ResultMessage(const char* operation, GhosttyResult result);
std::string GhosttyStringToString(GhosttyString value);
std::string BuildInfoString(GhosttyBuildInfo info);
std::string Utf8FromCodepoint(uint32_t codepoint);
std::string HexColor(uint8_t r, uint8_t g, uint8_t b);

}  // namespace libghostty_vt_node
