//go:build linux

package plat

import "fmt"

func P() string { fmt.Println("linux"); return "linux" }
