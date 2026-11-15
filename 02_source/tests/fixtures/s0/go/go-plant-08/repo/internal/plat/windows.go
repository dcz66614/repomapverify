//go:build windows

package plat

import "example.com/demo/internal/winonly"

func P() string { return winonly.W() }
