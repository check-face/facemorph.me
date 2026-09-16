// Minimal standalone types required by Pillow's image kernels; no Python runtime.
#pragma once
#define HAVE_PROTOTYPES 1
#define STDC_HEADERS 1
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <limits.h>
#include <assert.h>
typedef ptrdiff_t Py_ssize_t;
typedef struct {int unused;} PyObject;
