cmake_minimum_required(VERSION 3.12)
project(DaVerb CXX)

set(SC_PATH "" CACHE PATH "SuperCollider source checkout matching the installed scsynth")
if(NOT EXISTS "${SC_PATH}/include/plugin_interface/SC_PlugIn.hpp")
  message(FATAL_ERROR "Set -DSC_PATH to a SuperCollider source checkout")
endif()

if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT)
  set(CMAKE_INSTALL_PREFIX "$ENV{HOME}/.local/share/SuperCollider/Extensions" CACHE PATH "" FORCE)
endif()

add_library(DaVerb MODULE DaVerb.cpp)
target_include_directories(DaVerb PRIVATE "${SC_PATH}/include/plugin_interface" "${SC_PATH}/include/common")
target_compile_features(DaVerb PRIVATE cxx_std_17)
set_target_properties(DaVerb PROPERTIES PREFIX "" SUFFIX ".so" CXX_VISIBILITY_PRESET hidden)

install(TARGETS DaVerb LIBRARY DESTINATION DaVerb)
install(FILES DaVerb.sc DESTINATION DaVerb)
