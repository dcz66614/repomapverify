//go:build go1.21

package plat

import "fmt"

func P() string { fmt.Println("new"); return "new" }
