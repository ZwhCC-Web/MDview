MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 64K  RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 16K }
ENTRY(main)
SECTIONS {
  .text : { *(.text*) } > FLASH
  .rodata : { *(.rodata*) } > FLASH
  .data : { *(.data*) } > RAM AT > FLASH
  .bss : { *(.bss*) *(COMMON) } > RAM
  /DISCARD/ : { *(.note*) *(.eh_frame*) *(.comment) }
}
