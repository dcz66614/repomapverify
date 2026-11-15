package main

import (
	"fmt"
	a "example.com/demo/internal/a"
	_ "example.com/demo/internal/b"
)

func main() { fmt.Println(a.X) }
