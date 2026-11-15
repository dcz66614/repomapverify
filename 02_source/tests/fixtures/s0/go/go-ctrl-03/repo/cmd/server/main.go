package main

import (
	"fmt"
	"example.com/demo/internal/gen"
	"example.com/demo/internal/native"
	"example.com/demo/internal/onlygen"
)

func main() { fmt.Println(gen.X, native.Y, onlygen.Z) }
